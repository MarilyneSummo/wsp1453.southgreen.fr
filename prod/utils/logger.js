const fs = require('fs');

function logToFile(message, socketId = 'unknown') {
    try {
        let safeMessage = message;
        if (message === null || message === undefined) {
            safeMessage = '[null/undefined]';
        } else if (typeof message === 'object') {
            safeMessage = JSON.stringify(message, (key, value) => 
                typeof value === 'bigint' ? value.toString() + 'n' : value
            ).slice(0, 1000);
        } else {
            safeMessage = String(message);
        }

		const timestamp = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
        const logLine = `[${timestamp}] [${socketId}] ${safeMessage}\n`;
        
        fs.appendFileSync('server.log', logLine);
        console.log(logLine.trim());
    } catch (error) {
        console.error('ERREUR logToFile:', error.message);
    }
}

module.exports = { logToFile };
