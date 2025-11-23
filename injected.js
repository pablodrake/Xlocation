(function () {
    const XHR = XMLHttpRequest.prototype;
    const open = XHR.open;
    const send = XHR.send;
    const setRequestHeader = XHR.setRequestHeader;
    const originalFetch = window.fetch;

    // Capture auth headers
    let authHeaders = {};

    let lastBroadcastHeaders = null;

    function broadcastHeaders() {
        if (authHeaders.Authorization && authHeaders['x-csrf-token']) {
            const currentHeadersStr = JSON.stringify(authHeaders);
            if (currentHeadersStr !== lastBroadcastHeaders) {
                lastBroadcastHeaders = currentHeadersStr;
                window.postMessage({
                    type: 'X_COUNTRY_AUTH_HEADERS',
                    payload: authHeaders
                }, '*');
            }
        }
    }

    function checkAndBroadcast(url, responseBody) {
        if (url.includes('HomeTimeline') || url.includes('UserByScreenName')) {
            window.postMessage({
                type: 'X_COUNTRY_TIMELINE_DATA',
                payload: responseBody
            }, '*');
        }
    }

    // Hook Fetch
    window.fetch = async function (...args) {
        const [resource, config] = args;

        // Capture headers if present
        if (config && config.headers) {
            let headers = config.headers;
            if (headers instanceof Headers) {
                if (headers.has('authorization')) authHeaders.Authorization = headers.get('authorization');
                if (headers.has('x-csrf-token')) authHeaders['x-csrf-token'] = headers.get('x-csrf-token');
            } else {
                // Plain object
                for (let key in headers) {
                    if (key.toLowerCase() === 'authorization') authHeaders.Authorization = headers[key];
                    if (key.toLowerCase() === 'x-csrf-token') authHeaders['x-csrf-token'] = headers[key];
                }
            }
            broadcastHeaders();
        }

        const response = await originalFetch.apply(this, args);

        const clone = response.clone();
        try {
            const data = await clone.json();
            checkAndBroadcast(resource.toString(), data);
        } catch (e) {
            // ignore non-json
        }

        return response;
    };

    // Hook XHR
    XHR.setRequestHeader = function (header, value) {
        if (header.toLowerCase() === 'authorization') {
            authHeaders.Authorization = value;
        }
        if (header.toLowerCase() === 'x-csrf-token') {
            authHeaders['x-csrf-token'] = value;
        }
        broadcastHeaders();
        return setRequestHeader.apply(this, arguments);
    };

    XHR.open = function (method, url) {
        this._url = url;
        return open.apply(this, arguments);
    };

    XHR.send = function (postData) {
        this.addEventListener('load', function () {
            if (this._url && (this._url.includes('HomeTimeline') || this._url.includes('UserByScreenName'))) {
                try {
                    const data = JSON.parse(this.responseText);
                    window.postMessage({
                        type: 'X_COUNTRY_TIMELINE_DATA',
                        payload: data
                    }, '*');
                } catch (e) {
                    // ignore
                }
            }
        });
        return send.apply(this, arguments);
    };
})();
