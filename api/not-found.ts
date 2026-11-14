// Keep unknown API requests separate from the React application's HTML fallback.
export default {
  fetch(): Response {
    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  },
};
