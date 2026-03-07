import { Router, Request, Response } from 'express';

const router = Router();

// IPFS proxy — rewrites ipfs.io URLs so mobile clients load images reliably
router.get('/:cid', async (req: Request, res: Response) => {
  try {
    const ipfsPath = req.params.cid;
    if (!ipfsPath) {
      res.status(400).send('Missing IPFS path');
      return;
    }
    const ipfsUrl = `https://ipfs.io/ipfs/${ipfsPath}`;
    const upstream = await fetch(ipfsUrl);
    if (!upstream.ok) {
      res.status(upstream.status).send('IPFS fetch failed');
      return;
    }
    const contentType = upstream.headers.get('content-type');
    if (contentType) res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    console.error('IPFS proxy error:', err);
    res.status(502).send('IPFS proxy error');
  }
});

export default router;
