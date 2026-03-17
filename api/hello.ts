export default function handler(_req, res) {
  return res.status(200).json({ ok: true, now: new Date().toISOString() })
}

