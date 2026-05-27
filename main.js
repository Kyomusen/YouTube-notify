const fs = require('fs');
const https = require('https');

const CONFIG_FILE = './config.json';
const HISTORY_FILE = './history.json';

function fetchData(url) {
	return new Promise((resolve, reject) => {
		https.get(url, (res) => {
			let data = '';
			res.on('data', (chunk) => data += chunk);
			res.on('end', () => resolve(data));
		}).on('error', (err) => reject(err));
	});
}

function sendWebhook(url, message) {
	return new Promise((resolve, reject) => {
		const data = JSON.stringify({ content: message });
		console.log(`[Payload] Full JSON Request Body:\n${data}`);
		const urlObj = new URL(url);
		const options = {
			hostname: urlObj.hostname,
			path: urlObj.pathname,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Content-Length': Buffer.byteLength(data)
			}
		};
		const req = https.request(options, (res) => {
			let responseData = '';
			res.on('data', (chunk) => responseData += chunk);
			res.on('end', () => {
				if (res.statusCode >= 200 && res.statusCode < 300) {
					console.log(`[Success] Webhook sent successfully with status: ${res.statusCode}`);
					resolve();
				} else {
					console.error(`[Error] Discord returned status: ${res.statusCode}`);
					console.error(`[Response] ${responseData}`);
					resolve();
				}
			});
		});
		req.on('error', (err) => reject(err));
		req.write(data);
		req.end();
	});
}

function parseLatestVideo(xmlString) {
	const entryMatch = xmlString.match(/<entry>[\s\S]*?<\/entry>/);
	if (!entryMatch) return null;
	const entry = entryMatch[0];
	const idMatch = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
	const titleMatch = entry.match(/<title>([^<]+)<\/title>/);
	const linkMatch = entry.match(/<link rel="alternate" href="([^"]+)"/);
	if (!idMatch || !titleMatch || !linkMatch) return null;
	const isLive = entry.includes('broadcast') || entry.includes('live') || !entry.includes('media:description');
	return {
		id: idMatch[1],
		title: titleMatch[1],
		link: linkMatch[1],
		isLive: isLive
	};
}

async function main() {
	try {
		console.log('[Start] Checking for new YouTube videos...');
		if (!fs.existsSync(CONFIG_FILE)) {
			console.error(`[Error] Config file not found at ${CONFIG_FILE}`);
			return;
		}
		const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
		console.log(`[Config] Target Channel ID: ${config.channel_id}`);
		const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${config.channel_id}`;
		const xmlData = await fetchData(rssUrl);
		const latestVideo = parseLatestVideo(xmlData);
		if (!latestVideo) {
			console.log('[Info] No videos found or failed to parse XML feed.');
			return;
		}
		console.log(`[Fetch] Latest Video ID: ${latestVideo.id}`);
		console.log(`[Fetch] Latest Video Title: ${latestVideo.title}`);
		console.log(`[Type Check] Is Live Stream/Premiere: ${latestVideo.isLive}`);
		let history = [];
		if (fs.existsSync(HISTORY_FILE)) {
			history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
		}
		if (!history.includes(latestVideo.id)) {
			console.log('[Process] New video detected. Attempting to send notification...');
			const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
			if (webhookUrl) {
				let template = latestVideo.isLive ? (config.live || config.text) : (config.video || config.text);
				if (!template) {
					template = 'new video! {link}';
				}
				let message = template.replace('{title}', latestVideo.title).replace('{link}', latestVideo.link);
				await sendWebhook(webhookUrl, message);
			} else {
				console.error('[Error] DISCORD_WEBHOOK_URL is missing in environment variables.');
			}
			history.push(latestVideo.id);
			if (history.length > 20) history.shift();
			fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
			console.log('[Success] History updated.');
		} else {
			console.log('[Info] Video has already been notified. Skipping.');
		}
	} catch (error) {
		console.error('[Fatal Error] An unexpected error occurred in main execution:');
		console.error(error);
		process.exit(1);
	}
}

main();
