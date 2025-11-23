// Inject the interceptor script
const s = document.createElement('script');
s.src = chrome.runtime.getURL('injected.js');
s.onload = function () {
    this.remove();
};
(document.head || document.documentElement).appendChild(s);

let authHeaders = null;
const processedUsers = new Set();
const userCountryMap = new Map(); // screen_name -> country

window.addEventListener('message', function (event) {
    if (event.source !== window) return;

    if (event.data.type === 'X_COUNTRY_AUTH_HEADERS') {
        authHeaders = event.data.payload;
        // Only log if it's the first time or headers changed (though injected.js handles change detection too)
        if (!window.hasLoggedAuthHeaders) {
            console.log('X Country: Auth headers captured', authHeaders);
            window.hasLoggedAuthHeaders = true;
        }
    }

    if (event.data.type === 'X_COUNTRY_TIMELINE_DATA') {
        processTimelineData(event.data.payload);
    }
});

function processTimelineData(data) {
    // Traverse the JSON to find users
    // This is a simplified traversal, might need to be more robust
    const users = [];

    // Helper to recursively find objects with 'user_results'
    function findUsers(obj) {
        if (!obj) return;
        if (typeof obj !== 'object') return;

        if (obj.user_results && obj.user_results.result) {
            users.push(obj.user_results.result);
        }

        // Also check for core.user_results which was in the example
        if (obj.core && obj.core.user_results && obj.core.user_results.result) {
            users.push(obj.core.user_results.result);
        }

        for (const key in obj) {
            findUsers(obj[key]);
        }
    }

    findUsers(data);

    users.forEach(user => {
        const screenName = user.core?.screen_name || user.legacy?.screen_name;
        if (screenName && !processedUsers.has(screenName)) {
            processedUsers.add(screenName);
            // fetchAccountLocation(screenName); // Disable auto-fetch to avoid rate limits
        }
    });
}

async function fetchAccountLocation(screenName) {
    if (!authHeaders) {
        console.warn('X Country: No auth headers yet, skipping fetch for', screenName);
        return;
    }

    const queryId = 'XRqGa7EeokUU5kppkh13EA';
    const variables = encodeURIComponent(JSON.stringify({ screenName }));
    const url = `https://x.com/i/api/graphql/${queryId}/AboutAccountQuery?variables=${variables}`;

    try {
        const response = await fetch(url, {
            headers: {
                'authorization': authHeaders.Authorization,
                'x-csrf-token': authHeaders['x-csrf-token'],
                'content-type': 'application/json'
            }
        });
        const data = await response.json();
        const country = data.data?.user_result_by_screen_name?.result?.about_profile?.account_based_in;

        if (country) {
            userCountryMap.set(screenName, country);
            console.log(`X Country: ${screenName} is based in ${country}`);
            updateUI();
        }
    } catch (e) {
        console.error('X Country: Failed to fetch location for', screenName, e);
    }
}

function updateUI() {
    // Find all tweet elements
    const tweets = document.querySelectorAll('[data-testid="tweet"]');
    // Find all conversation elements
    const conversations = document.querySelectorAll('[data-testid="conversation"]');

    const processItem = (item, type) => {
        let screenName;
        let header;

        if (type === 'tweet') {
            const userLink = item.querySelector('a[href^="/"][role="link"]');
            if (!userLink) return;
            const href = userLink.getAttribute('href');
            screenName = href.substring(1);
            header = item.querySelector('[data-testid="User-Name"]');
        } else if (type === 'conversation') {
            // In DMs, the text usually contains the display name and handle like "@username"
            // We need to find the handle.
            // Based on the HTML structure, the handle is often in a span starting with @
            const spans = item.querySelectorAll('span');
            for (const span of spans) {
                if (span.textContent.trim().startsWith('@')) {
                    screenName = span.textContent.trim().substring(1);
                    break;
                }
            }

            // If we found a screen name, we need a place to put the flag.
            // We can try to put it next to the display name or the handle.
            // Let's try to find the display name container or just append to the handle container for now.
            // Re-using the same logic as tweets might be tricky if the structure is very different.
            // Let's look for the group that contains the handle.
            if (screenName) {
                // Try to find the element containing the handle to append next to it, or the display name.
                // For now, let's try to append to the same container where we found the handle, or its parent.
                // Actually, let's look for the display name which usually doesn't start with @.
                // But sticking to the handle is safer for identification.

                // Let's try to find a good place to insert.
                // In the HTML provided:
                // <div ... data-testid="conversation" ...>
                //   ...
                //   <span ...>@prosper_AR</span>
                //   ...
                // </div>

                // We can append to the parent of the handle span.
                const handleSpan = Array.from(item.querySelectorAll('span')).find(s => s.textContent.trim().startsWith('@' + screenName));
                if (handleSpan) {
                    header = handleSpan.parentElement;
                    // Ensure the header is a flex container and handles overflow
                    header.style.display = 'flex';
                    header.style.minWidth = '0'; // Allow shrinking below content size

                    // Style the handle span to truncate
                    handleSpan.style.overflow = 'hidden';
                    handleSpan.style.textOverflow = 'ellipsis';
                    handleSpan.style.whiteSpace = 'nowrap';
                    handleSpan.style.flexShrink = '1';
                    handleSpan.style.minWidth = '0';
                }
            }
        }

        if (!screenName || !header) return;

        // Check if we already have a label/button
        let existingLabel = item.querySelector('.x-country-label');

        if (userCountryMap.has(screenName)) {
            const country = userCountryMap.get(screenName);
            const flag = getFlagEmoji(country);

            // If we have a button (or nothing), replace with flag
            if (!existingLabel || existingLabel.dataset.type === 'button') {
                if (existingLabel) existingLabel.remove();

                const label = document.createElement('span');
                label.className = 'x-country-label';
                label.dataset.type = 'flag';
                label.style.marginLeft = '4px';
                label.style.fontSize = '1.5em'; // Bigger flag
                label.textContent = flag || `📍 ${country}`;
                label.title = `Based in ${country}`;
                label.style.flexShrink = '0'; // Prevent flag from shrinking

                header.appendChild(label);
            }
        } else {
            // No data yet. Show button if not exists.
            if (!existingLabel) {
                const button = document.createElement('span');
                button.className = 'x-country-label';
                button.dataset.type = 'button';
                button.style.marginLeft = '4px';
                button.style.cursor = 'pointer';
                button.style.fontSize = '1.2em';
                button.textContent = '📍';
                button.title = 'Click to fetch location';
                button.style.flexShrink = '0'; // Prevent button from shrinking
                button.dataset.screenName = screenName; // Store screen name for observer

                button.onclick = (e) => {
                    e.stopPropagation(); // Prevent click
                    e.preventDefault();
                    button.textContent = '⏳'; // Loading state
                    fetchAccountLocation(screenName);
                };

                header.appendChild(button);
                intersectionObserver.observe(button); // Start observing
            }
        }
    };

    tweets.forEach(tweet => processItem(tweet, 'tweet'));
    conversations.forEach(conversation => processItem(conversation, 'conversation'));
}

// Queue for auto-fetching
const fetchQueue = [];
let isProcessingQueue = false;
const COOLDOWN_MS = 2000; // 2 seconds cooldown

function processQueue() {
    if (isProcessingQueue || fetchQueue.length === 0) return;

    isProcessingQueue = true;
    const screenName = fetchQueue.shift();

    // Find the button to update its state (visual feedback)
    // This is a bit expensive, maybe we can optimize later if needed
    // For now, we just fetch. The fetchAccountLocation function handles the UI update via userCountryMap and updateUI

    // We can also find the specific button to show "loading" if we want, but fetchAccountLocation doesn't take a button element.
    // Let's just call fetch.

    console.log(`X Country: Auto-fetching for ${screenName}`);
    fetchAccountLocation(screenName).finally(() => {
        setTimeout(() => {
            isProcessingQueue = false;
            processQueue();
        }, COOLDOWN_MS);
    });
}

// Intersection Observer to trigger fetches
const observerOptions = {
    root: null, // viewport
    rootMargin: '0px',
    threshold: 0.1 // Trigger when 10% visible
};

const intersectionObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const button = entry.target;
            const screenName = button.dataset.screenName;

            if (screenName && !userCountryMap.has(screenName) && !fetchQueue.includes(screenName)) {
                // Check if already fetched or processing (processedUsers set in content.js might be useful but it's not fully utilized for this specific logic flow yet, let's rely on userCountryMap and queue)
                // Actually, let's use a separate set for queued items to avoid duplicates in queue efficiently
                if (!queuedUsers.has(screenName)) {
                    queuedUsers.add(screenName);
                    fetchQueue.push(screenName);
                    button.textContent = '⏳'; // Show loading state immediately
                    processQueue();
                }
            }

            // Stop observing once queued
            intersectionObserver.unobserve(button);
        }
    });
}, observerOptions);

const queuedUsers = new Set();

// Run updateUI periodically or on mutation
const observer = new MutationObserver(() => {
    updateUI();
});

observer.observe(document.body, { childList: true, subtree: true });
