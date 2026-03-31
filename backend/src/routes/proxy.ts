import { Router, Request, Response } from 'express';

const router = Router();

// Valid IPFS CID pattern: base58btc (CIDv0) or base32/base36 (CIDv1)
const VALID_CID = /^[a-zA-Z0-9]+$/;

// IPFS proxy — rewrites ipfs.io URLs so mobile clients load images reliably
router.get('/:cid', async (req: Request, res: Response) => {
  try {
    const ipfsPath = Array.isArray(req.params.cid) ? req.params.cid[0] : req.params.cid;
    if (!ipfsPath || !VALID_CID.test(ipfsPath)) {
      res.status(400).send('Invalid IPFS CID');
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
