const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});

const PORT = process.env.PORT || 4301;
const FETCH_INTERVAL = 2 * 60 * 1000; // 2 minutos
const ONPE_SOURCE = 'https://voz.pe/data.json';

// Estado global
let latestData = null;
let lastFetchTime = null;
let fetchErrors = 0;
let visitors = { online: 0, total: 0 };

// Servir archivos estáticos desde /public
app.use(express.static(path.join(__dirname, 'public')));

// API endpoints
app.get('/api/data', (req, res) => {
    if (!latestData) {
        return res.status(503).json({ ok: false, error: 'Datos no disponibles aún' });
    }
    res.json({
        ...latestData,
        _meta: {
            fetchedAt: lastFetchTime,
            fetchErrors,
            online: visitors.online,
            total: visitors.total
        }
    });
});

app.get('/api/status', (req, res) => {
    res.json({
        ok: true,
        hasData: !!latestData,
        lastFetch: lastFetchTime,
        fetchErrors,
        online: visitors.online,
        total: visitors.total,
        uptime: process.uptime()
    });
});

// WebSocket - conexiones en tiempo real
wss.on('connection', (ws) => {
    visitors.online++;
    visitors.total++;

    // Enviar datos actuales al conectarse
    if (latestData) {
        ws.send(JSON.stringify({
            type: 'data',
            payload: latestData,
            meta: { online: visitors.online, total: visitors.total }
        }));
    }

    // Broadcast online count
    broadcast({ type: 'visitors', payload: { online: visitors.online, total: visitors.total } });

    ws.on('close', () => {
        visitors.online--;
        broadcast({ type: 'visitors', payload: { online: visitors.online, total: visitors.total } });
    });

    ws.on('error', () => {
        visitors.online--;
    });
});

function broadcast(message) {
    const data = JSON.stringify(message);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

// Fetch datos de ONPE (via voz.pe que ya los agrega)
async function fetchONPEData() {
    try {
        const res = await fetch(ONPE_SOURCE, {
            headers: {
                'User-Agent': 'VozPE-Tracker/1.0',
                'Accept': 'application/json'
            },
            timeout: 15000
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'Data not ok');

        const changed = !latestData ||
            latestData.actas.porcentaje !== data.actas.porcentaje ||
            latestData.sanchez.totalVotosValidos !== data.sanchez.totalVotosValidos ||
            latestData.lopez.totalVotosValidos !== data.lopez.totalVotosValidos;

        latestData = data;
        lastFetchTime = new Date().toISOString();
        fetchErrors = 0;

        if (changed) {
            console.log(`[${new Date().toLocaleTimeString()}] Datos actualizados - Actas: ${data.actas.porcentaje}% | Sánchez: ${data.sanchez.totalVotosValidos} | López Aliaga: ${data.lopez.totalVotosValidos}`);
            broadcast({
                type: 'data',
                payload: data,
                meta: { online: visitors.online, total: visitors.total }
            });
        } else {
            console.log(`[${new Date().toLocaleTimeString()}] Sin cambios`);
        }
    } catch (err) {
        fetchErrors++;
        console.error(`[${new Date().toLocaleTimeString()}] Error fetch #${fetchErrors}: ${err.message}`);

        // Si no tenemos datos, usar fallback
        if (!latestData) {
            latestData = getFallbackData();
            lastFetchTime = new Date().toISOString();
            broadcast({
                type: 'data',
                payload: latestData,
                meta: { online: visitors.online, total: visitors.total }
            });
        }
    }
}

function getFallbackData() {
    return {
        ok: true,
        timestamp: Date.now(),
        actas: {
            porcentaje: 93.058,
            contabilizadas: 86326,
            total: 92766,
            enviadasJee: 5413,
            pendientesJee: 1027
        },
        sanchez: {
            nombreAgrupacionPolitica: "JUNTOS POR EL PERÚ",
            codigoAgrupacionPolitica: 10,
            nombreCandidato: "ROBERTO HELBERT SANCHEZ PALOMINO",
            totalVotosValidos: 1880266,
            porcentajeVotosValidos: 11.973,
            porcentajeVotosEmitidos: 9.982
        },
        lopez: {
            nombreAgrupacionPolitica: "RENOVACIÓN POPULAR",
            codigoAgrupacionPolitica: 35,
            nombreCandidato: "RAFAEL BERNARDO LÓPEZ ALIAGA CAZORLA",
            totalVotosValidos: 1873567,
            porcentajeVotosValidos: 11.930,
            porcentajeVotosEmitidos: 9.947
        }
    };
}

// Iniciar fetch periódico
fetchONPEData();
setInterval(fetchONPEData, FETCH_INTERVAL);

// Iniciar servidor
server.listen(PORT, () => {
    console.log(`\n  🗳️  VOZ.PE - Tracker Electoral en Vivo`);
    console.log(`  ────────────────────────────────────`);
    console.log(`  Servidor:   http://localhost:${PORT}`);
    console.log(`  WebSocket:  ws://localhost:${PORT}`);
    console.log(`  API:        http://localhost:${PORT}/api/data`);
    console.log(`  Fuente:     ONPE (via ${ONPE_SOURCE})`);
    console.log(`  Refresh:    cada ${FETCH_INTERVAL / 1000}s`);
    console.log(`  ────────────────────────────────────\n`);
});
