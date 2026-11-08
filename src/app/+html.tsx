import { ScrollViewStyleReset, useServerDocumentContext } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

/**
 * Root HTML for the web app (runs in Node during rendering, so no browser APIs here).
 * Makes Lobb installable as a PWA: manifest, home-screen icon and full-screen mode on iPhone,
 * theme colors, and the service worker (public/sw.js).
 */
const BACKGROUND = `
body { background-color: #F6F5FA; }
@media (prefers-color-scheme: dark) { body { background-color: #16111F; } }
`;

const REGISTER_SW = `
if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
  window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });
}
`;

export default function Root({ children }: PropsWithChildren) {
  const { headNodes, bodyNodes, htmlAttributes, bodyAttributes } = useServerDocumentContext();
  return (
    <html lang="en" {...htmlAttributes}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
        <title>Lobb</title>
        <meta name="description" content="Snacks, drinks and chargers from the neighbor down the hall, plus stuff you can borrow." />

        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#F6F5FA" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#16111F" media="(prefers-color-scheme: dark)" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Lobb" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />

        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: BACKGROUND }} />
        <script dangerouslySetInnerHTML={{ __html: REGISTER_SW }} />
        {headNodes}
      </head>
      <body {...bodyAttributes}>
        {children}
        {bodyNodes}
      </body>
    </html>
  );
}
