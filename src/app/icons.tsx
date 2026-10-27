// Small inline icons (stroke = currentColor).
const P = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
export const IconPlay = () => <svg {...P}><path d="M7 4.5v15l12-7.5z" fill="currentColor" /></svg>;
export const IconPause = () => <svg {...P}><rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" /><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" /></svg>;
export const IconStop = () => <svg {...P}><rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" /></svg>;
export const IconReplay = () => <svg {...P}><path d="M4 12a8 8 0 1 0 2.4-5.7" /><path d="M4 4v4h4" /></svg>;
export const IconLoop = () => <svg {...P}><path d="M17 2l3 3-3 3" /><path d="M4 11V9a4 4 0 0 1 4-4h12" /><path d="M7 22l-3-3 3-3" /><path d="M20 13v2a4 4 0 0 1-4 4H4" /></svg>;
export const IconDownload = () => <svg {...P}><path d="M12 4v11" /><path d="M7 10l5 5 5-5" /><path d="M5 20h14" /></svg>;
export const IconUpload = () => <svg {...P}><path d="M12 20V9" /><path d="M7 14l5-5 5 5" /><path d="M5 4h14" /></svg>;
export const IconSliders = () => <svg {...P}><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></svg>;
