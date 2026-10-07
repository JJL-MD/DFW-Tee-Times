# Provider Terms of Service — Personal-Use Assessment

> **Important:** This is a personal-use aggregator. Scraping most booking sites
> violates their TOS. The summary below reflects my reading as of January 2026.
> Verify with each provider's current TOS before deploying.

## GolfNow (NBC Sports Next)

- **Personal scraping**: Generally tolerated if low frequency; ToS prohibits
  automated booking.
- **Automated booking (Option B)**: Explicitly prohibited. Risks account
  suspension.
- **Recommended**: Use GolfNow Affiliate API (free, requires approval) for
  availability. For booking, link out to the provider — let the user click
  "Book" and complete the form manually in their logged-in browser.
- **Risk level if auto-booking**: HIGH — account termination, no recourse.

## TeeOff (NBC Sports Next)

- Same parent company as GolfNow. Same ToS, same Affiliate API program.
- **Recommended**: Same as GolfNow.

## Chronogolf

- **Public API**: Available for partners; self-service signup.
- **Personal scraping**: Gray area; Chronogolf tends to be more permissive than
  GolfNow for low-volume personal use.
- **Recommended**: Apply for partner API access. Don't auto-book.

## ForeUp

- **Public search endpoint**: Used by many public/municipal courses via the
  browser UI. The API is the same browser endpoint — no official partner
  program.
- **Personal scraping**: Many municipal courses explicitly use ForeUp because
  it's "open" — but ToS still reserves the right to block.
- **Recommended**: Scrape at ≤1 req per course per 15 min. Don't auto-book
  unless you have explicit course authorization.

## Course-direct systems (MiClub, Quick18, Lightspeed, Club Prophet, EZLinks)

- Each vendor has its own ToS. Most prohibit scraping.
- **Recommended**: Many of these expose partner/affiliate endpoints if you ask.
  For personal use, scrape sparingly and link out for booking.

## Chrome extension (cookies)

- Exporting cookies for personal use is a gray area. Google Chrome's ToS
  permits extensions but the *use* of exported cookies is governed by the
  target site's ToS.
- **Mitigation**: Only use cookies you obtained via your own logged-in
  browser session. Never share the vault contents.

## Recommendations for this project

1. **Default to read-only** — scrape availability, deep-link to provider
   for booking. Auto-book only if you've explicitly accepted the risk.
2. **If you must auto-book**:
   - Use provider partner APIs where available
   - Cap concurrency to 1 per host, jitter 100-300ms
   - Never share your vault or executor output
   - Monitor for account warnings; back off if you get rate-limited
3. **Never resell** — this aggregator is for personal use only. Commercial
   use voids most providers' goodwill entirely.

## Update cadence

Re-review this file annually or whenever a provider sends a cease-and-desist.
