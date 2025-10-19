// URL.parse polyfill for browsers/environments where it's not available
// Some libraries mistakenly call `URL.parse(...)` (Node-style), which isn't part of the
// standard Web URL API. We provide a minimal shim that returns a WHATWG URL instance.

export {}

declare global {
	interface URLConstructor {
		// Optional static method added by this polyfill
		parse?: (input: string, base?: string | URL) => URL | null
	}
}

;(function attachURLParsePolyfill() {
	try {
		// Ensure URL exists (modern browsers)
		const URLAny = URL as unknown as { parse?: (input: string, base?: string | URL) => URL | null }
		if (typeof URLAny.parse !== 'function') {
			URLAny.parse = function (input: string, base?: string | URL): URL | null {
				try {
					return new URL(input, base ?? (typeof window !== 'undefined' ? window.location.href : undefined))
				} catch (_) {
					return null
				}
			}
		}
	} catch (_) {
		// Ignore if URL isn't available; nothing to polyfill.
	}
})()

