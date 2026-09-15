# reach check (Google Apps Script)

A managed Chromebook usually blocks `file://`, so a downloaded HTML page will
not run, and GitHub Pages may be blocked as well. Apps Script gets around both:
it serves a real page from a Google origin, and the JavaScript in it runs in
**your** browser on **your** network — the only place an honest answer about
what your network blocks can come from.

## Use it

1. Open <https://script.google.com> and make a **New project**.
2. Delete whatever is in the editor, paste all of [`Code.gs`](Code.gs), save.
3. **Deploy → New deployment → Web app**
   - *Execute as*: **Me**
   - *Who has access*: **Only myself**
4. Authorise it when asked. Google will warn that the app is unverified because
   you wrote it yourself — continue past that.
5. Open the `/exec` URL it hands you, click **Run check**, then **Copy results**.

A tick means your browser opened a connection to that host. A cross usually
means your network blocks it. `example.com` is the control: if *that* fails,
the test is being blocked, not the sites.

## Notes

- Use a personal Google account if you can. School-managed accounts often
  disable Apps Script deployment entirely.
- `serverProbe()` in `Code.gs` fetches from *Google's* network rather than
  yours. It is there for contrast: a host that answers there but fails in the
  browser check is one your network is blocking, not one that is down.
- It only checks whether hosts answer. It reads nothing and proxies nothing.
