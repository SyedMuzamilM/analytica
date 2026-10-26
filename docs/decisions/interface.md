# Dashboard direction

The dashboard uses a quiet application shell with a narrow white sidebar, cool off-white canvas and cobalt data marks. Dense numbers and source rows carry the visual hierarchy. One continuous traffic chart and proportional acquisition bars are the main visual elements; decorative cards and marketing illustrations are unnecessary.

Palette: canvas `#f5f6f8`, panel `#ffffff`, ink `#202938`, secondary `#667487`, cobalt `#315bd8`, positive `#16805a`. Typography uses the local system sans-serif stack with tabular figures. Content stays left aligned; period, filters and timezone remain visible above reporting views. Mobile layouts collapse the sidebar and preserve table readability.

The `/demo` route generates a deterministic synthetic dataset and labels it throughout. It never calls customer report endpoints or writes sample records. Filters, period changes and navigation update the URL and recompute sample reports. Authenticated views always use the API; failures never fall back to demo traffic.

Setup uses a passkey and a private installation token. Customer-visible forms contain no password defaults or deployment API credentials. Recovery codes display only when the server returns newly generated codes. Workspace/account controls are reachable directly below the workspace selector, including workspace creation, owner-managed invitations/membership, passkey registration, recovery-code replacement and all-session revocation. Tokens and codes stay in component memory, never URL parameters or browser storage.

Live revenue uses the actual ledger response, formats integer minor units with the currency exponent and keeps currency totals separate. Pending or quarantined refunds have an explicit warning. Server keys display once and signing secrets are never included in generated installation prompts. Demo revenue deliberately contains no fabricated sales.
