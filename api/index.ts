import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Vercel Serverless Function Bridge
 * This file acts as an entry point for Vercel to route requests to the Express app.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // The build:vercel script bundles the Express app into app.cjs
    // We import it here to handle the request.
    const { default: app } = await import('../artifacts/api-server/dist/vercel/app.cjs');
    
    // Express app is exported, we call it with req and res
    return app(req, res);
  } catch (error) {
    console.error('Vercel Bridge Error:', error);
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: 'Failed to load API handler. Ensure build:vercel has run.' 
    });
  }
}
