// Deploy: supabase functions deploy paynow-card-complete
//
// Browser redirect target for card payments. Paynow requires returnurl to
// start with https://, so the deep link cannot be used directly. After the
// user completes (or cancels) payment on the Paynow-hosted page, their
// browser is redirected here. The mobile WebView detects this URL and
// triggers the post-payment poll flow.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Payment Complete – Profit Protector</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #F4F6FB;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 24px;
    }
    .card {
      background: #fff;
      border-radius: 16px;
      padding: 40px 32px;
      max-width: 360px;
      width: 100%;
      text-align: center;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
    }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 20px; font-weight: 700; color: #0D1B3E; margin-bottom: 8px; }
    p  { font-size: 14px; color: #5A6A8A; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <h1>Payment Submitted</h1>
    <p>Returning you to Profit Protector&hellip;</p>
  </div>
</body>
</html>`

serve(() => {
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
})
