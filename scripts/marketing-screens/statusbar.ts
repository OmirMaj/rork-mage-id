// scripts/marketing-screens/statusbar.ts: the phone's status bar.
//
// A web page has no status bar, so a capture of the app at phone size would
// have an empty strip where the phone draws one. This draws the standard
// 9:41 bar (time, cell bars, Wi-Fi, full battery) into the top safe area,
// over whatever the app painted there, in the system font. It is the phone's
// chrome, not the app's: nothing inside the app's own area is touched.
// `fill`: for a screen with no header of its own once it is scrolled (the
// client view), the strip takes the page colour found just under it, so the
// clock does not sit on top of the words scrolling beneath. Only the strip.
export function statusBarScript(theme: 'light' | 'dark', insets: { top: number }, tone?: 'light' | 'dark', fill = false): string {
  // tone = the colour of the glyphs. Dark glyphs on a light app, and the reverse.
  const ink = (tone ?? (theme === 'dark' ? 'light' : 'dark')) === 'light' ? '#FFFFFF' : '#000000';
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="78" height="13" viewBox="0 0 78 13" fill="${ink}">
  <rect x="0" y="8.6" width="3.2" height="4.4" rx="0.9"/><rect x="4.9" y="6.1" width="3.2" height="6.9" rx="0.9"/>
  <rect x="9.8" y="3.3" width="3.2" height="9.7" rx="0.9"/><rect x="14.7" y="0.5" width="3.2" height="12.5" rx="0.9"/>
  <g transform="translate(24.5 0.4)"><path d="M8.6 2.5c2.4 0 4.6.9 6.3 2.5.1.1.3.1.4 0l1.1-1.1c.1-.1.1-.3 0-.5A11.3 11.3 0 0 0 8.6.3C5.700.3 3 1.400.8 3.400c-.1.2-.1.4 0 .5l1.100 1.100c.1.100.3.100.400 0A9.200 9.200 0 0 1 8.600 2.500Z"/>
  <path d="M8.600 6.300c1.300 0 2.500.500 3.500 1.300.1.100.3.100.400 0l1.100-1.100c.1-.1.100-.300 0-.500a7.400 7.400 0 0 0-10 0c-.1.200-.1.400 0 .5l1.100 1.100c.1.100.300.100.400 0 1-.800 2.200-1.300 3.500-1.300Z"/>
  <path d="M11.600 9.200c.1-.100.1-.300 0-.500a4.300 4.300 0 0 0-6 0c-.1.200-.1.400 0 .500l2.800 2.800c.1.100.3.100.4 0l2.800-2.800Z"/></g>
  <g transform="translate(49.500 0)"><rect x="0.500" y="0.500" width="24" height="12" rx="3.600" fill="none" stroke="${ink}" stroke-opacity="0.400"/>
  <rect x="2" y="2" width="21" height="9" rx="2.200"/><path d="M26 4.300v4.400c.9-.4 1.500-1.200 1.500-2.200s-.6-1.800-1.500-2.200Z" fill-opacity="0.450"/></g>
</svg>`.replace(/\n\s*/g, '');
  return `(() => {
    document.getElementById('__statusbar')?.remove();
    const bar = document.createElement('div');
    bar.id = '__statusbar';
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;height:${insets.top}px;z-index:2147483647;pointer-events:none;';
    bar.innerHTML = '<div style="position:absolute;left:0;width:138px;top:20px;text-align:center;font:600 17px/22px -apple-system,\\'SF Pro Text\\',\\'Helvetica Neue\\',sans-serif;letter-spacing:-0.3px;color:${ink}">9:41</div>'
      + '<div style="position:absolute;right:0;width:138px;top:24px;display:flex;justify-content:center">' + ${JSON.stringify(svg)} + '</div>';
    if (${fill ? 'true' : 'false'}) {
      const clear = (c) => !c || c === 'transparent' || /rgba\\(.*, 0\\)$/.test(c);
      const under = document.elementsFromPoint(2, ${insets.top} + 2).map((e) => getComputedStyle(e).backgroundColor).find((c) => !clear(c));
      if (under) bar.style.background = under;
    }
    document.body.appendChild(bar);
    return true;
  })()`;
}
