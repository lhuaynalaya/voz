export default async function handler(req, res) {
    try {
        const response = await fetch('https://voz.pe/data.json', {
            headers: {
                'User-Agent': 'VotoTV/1.0',
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            return res.status(response.status).json({ ok: false, error: 'ONPE no disponible' });
        }

        const data = await response.json();

        res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
        res.setHeader('Access-Control-Allow-Origin', '*');
        return res.status(200).json(data);
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
}
