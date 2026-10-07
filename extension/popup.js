// popup.js — runs in extension popup.
// Reads cookies for the configured domain via chrome.cookies.getAll,
// then writes a JSON array to the clipboard and to the <pre> for inspection.
document.getElementById("copy").addEventListener("click", async () => {
  const domain = document.getElementById("domain").value.trim();
  const out = document.getElementById("out");
  try {
    const cookies = await chrome.cookies.getAll({ domain });
    const projected = cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expirationDate ? Math.floor(c.expirationDate) : null,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite ?? undefined,
    }));
    const json = JSON.stringify(projected, null, 2);
    await navigator.clipboard.writeText(json);
    out.textContent = json;
  } catch (err) {
    out.textContent = "error: " + (err && err.message ? err.message : String(err));
  }
});