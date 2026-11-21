// Public settings of the web onboarding (specs/018-web-onboarding/contracts/start-page.md section 3).
// Every value ships to browsers, so nothing secret goes here. An empty value switches that part off:
// no Supabase settings = the example cut only; no PostHog key = no funnel events.
export default {
  supabaseUrl: '',
  supabaseKey: '',
  turnstileSiteKey: '0x4AAAAAAGLRL0oNaIcxu9M3', // the widget "TakesAI start", for takesai.app only (public; its secret is the function's TURNSTILE_SECRET_KEY)
  posthogKey: '',
  posthogHost: 'https://us.i.posthog.com',
};
