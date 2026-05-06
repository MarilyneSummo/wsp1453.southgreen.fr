const fs = require('fs');
const bodyParser = require("body-parser");
const path = require('path');

// Importation de la fonction de logging
const { logToFile } = require('./utils/logger');


var app = require('express')();
var https = require('https');
// var options = {
// key: fs.readFileSync('/opt/httpd/conf/ssl/star_southgreen_fr.key'),
// cert: fs.readFileSync('/opt/httpd/conf/ssl/star_southgreen_fr_cert.pem'),
// }
//caramy
var options = {
key: fs.readFileSync('/opt/httpd/conf/ssl/caramy.key'),
cert: fs.readFileSync('/opt/httpd/conf/ssl/caramy.crt'),
}
var server = https.createServer(options, app);
server.listen(1453, () => {
    console.log('Serveur HTTPS démarré sur le port 1453');
});
var io = require('socket.io')(server, {
    // pingInterval: 25000, // Intervalle d'envoi des pings au client (en ms)
    // pingTimeout: 600000,  // Délai avant de considérer la connexion comme perdue si aucun pong n'est reçu (en ms)
    cors: {
     origin: "*",
     credentials: true  }
});



app.use(bodyParser.urlencoded({extended: true})); //je crois que ça me permet de lire le body de ma requête ajax dans parse.js sendFile()..
app.use(bodyParser.json()); //donc je le laisse là.
//app.use(express.static(__dirname));

// Add headers
app.use(function (req, res, next) {

    // Website you wish to allow to connect
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Request methods you wish to allow
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');

    // Request headers you wish to allow
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');

    // Set to true if you need the website to include cookies in the requests sent
    // to the API (e.g. in case you use sessions)
    res.setHeader('Access-Control-Allow-Credentials', true);

    // Pass to next layer of middleware
    next();

});

//      _______.  ______     ______  __  ___  _______ .___________.    _______.
//     /       | /  __  \   /      ||  |/  / |   ____||  |   /       |
//    |   (----`|  |  |  | |  ,----'|  '  /  |  |__   `---| |----`  |   (----`
//     \   \    |  |  |  | |  |     |    <   |   __|      |  |       \   \
// .----)   |   |  `--'  | |  `----.|  .  \  |  |____     |  | .----)   |
// |_______/     \______/   \______||__|\__\ |_______|    |__| |_______/

io.on('connection', socket => {
    logToFile( `\n\nNouveau visiteur : *** ${socket.id}`, socket.id );

    //infos de connection
    socket.on('clientInfo', data => {
        const clientIp = socket.handshake.address;
        const userAgent = socket.handshake.headers['user-agent'];
        const cookies = socket.handshake.headers['cookie'];
        logToFile(`Le client s'est connecté depuis l'URL : ${data.url}, IP : ${clientIp}, User-Agent : ${userAgent}, Cookies : ${cookies}`, socket.id);
    });

    const gemoService = require('./services/gemoService');

    //repertoire de travail pour toolkit et gemo, spécifique à chaque socket pour éviter les conflits entre utilisateurs
    const toolkitWorkingPath = '/opt/www/synflow.southgreen.fr/prod/tmp/toolkit_run/';
    const toolkitAnalysisDir = toolkitWorkingPath + 'toolkit_' + socket.id +'/';

    // Crée le répertoire toolkit (code existant)
    try {
        fs.mkdirSync(toolkitAnalysisDir);
        logToFile(`Répertoire d'analyse créé : ${toolkitAnalysisDir}`, socket.id);
    } catch (err) {
        if (err.code !== 'EEXIST') throw err;
    }

    // Crée ET passe le répertoire GEMO au service
    const gemoAnalysisDir = '/opt/www/gemo.southgreen.fr/prod/tmp/gemo_run/gemo_' + socket.id + '/';
    try {
    fs.mkdirSync(gemoAnalysisDir);
    logToFile(`Répertoire GEMO créé : ${gemoAnalysisDir}`, socket.id);
    } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    }

    // ATTACHE les handlers GEMO
    gemoService.attachHandlers(socket, gemoAnalysisDir);

    // ATTACHE les handlers synflow
    const synflowService = require('./services/synflowService');
    app.use(synflowService.router);  // Monte la route /upload Synflow
    synflowService.attachHandlers(socket, toolkitAnalysisDir);

    // Écouter les messages de log du client
    socket.on('logMessage', (message) => {
        logToFile(`Client: ${message}`, socket.id);
    });

    //fonction commune pour tout les sites
    //quand le visiteur se déconnecte
    socket.on ( "disconnect" , function (){

        function rimraf(dir_path) {
            const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000;
            const now = Date.now();

            if (fs.existsSync(dir_path)) {
                fs.readdirSync(dir_path).forEach(function(entry) {
                    var entry_path = path.join(dir_path, entry);
                    var stats = fs.lstatSync(entry_path);
                    var mtime = stats.mtime.getTime();

                    if ((now - mtime) > TEN_DAYS_MS) {
                        if (stats.isDirectory()) {
                            rimraf(entry_path);
                        } else {
                            fs.unlinkSync(entry_path);
                        }
                    }
                });
                // Supprime le dossier si lui-même est vieux de plus de 10 jours et vide

                var dirStats = fs.lstatSync(dir_path);
                if ((now - dirStats.mtime.getTime()) > TEN_DAYS_MS && fs.readdirSync(dir_path).length === 0) {
                    fs.rmdirSync(dir_path);
                    logToFile("cleaning " + dir_path, socket.id);
                }
            }
        }
        rimraf(gemoAnalysisDir);//enlève les fichiers temporaires de gemo
        rimraf(toolkitWorkingPath);//enlève les fichiers temporaires du toolkit
    });
});