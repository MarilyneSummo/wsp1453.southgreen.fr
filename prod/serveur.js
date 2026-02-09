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

/////////////////////////// fonctions

// Fonction pour obtenir l'heure et la date actuelles au format lisible
function getCurrentTimestamp() {
    const now = new Date();
    return now.toLocaleString(); // Format: "jj/mm/aaaa, hh:mm:ss"
}

// Middleware qui génère un identifiant unique par lot
function assignUploadId(req, res, next) {
    if (!req.uploadId) {
        req.uploadId = Date.now() + '-' + Math.round(Math.random() * 1E9);
    }
    next();
}


// .______        ______    __    __  .___________. _______  _______.
// |   _  \      /  __  \  |  |  |  | |           ||   ____|   /      |
// |  |_)  |    |  |  |  | |  |  |  | `---|  |----`|  |__     |  (----`
// |      /     |  |  |  | |  |  |  |     |  |     |   __|     \  \
// |  |\  \----.|  `--'  | |  `--'  |     |  |     |  |____.----)  |
// | _| `._____| \______/   \______/      |__|  |_______|_______/

// Configuration de multer pour gérer les fichiers
const multer = require('multer'); //upload des fichiers
const { log } = require('console');
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, '/opt/www/synflow.southgreen.fr/prod/tmp/toolkit_run/');
    },
    filename: function (req, file, cb) {
        const prefix = req.uploadId || Date.now();
        // garde le nom original pour retrouver facilement
        cb(null, prefix + "_" + file.originalname);
    }
});
const upload = multer({ storage: storage });

// Route POST pour gérer l'upload de fichiers et les paramètres texte
app.post('/upload', assignUploadId, upload.any(), (req, res) => {
    const uploadedFiles = req.files.map(file => ({
        fieldname: file.fieldname,
        originalname: file.originalname, // nom original utile pour mapping
        filename: file.filename,         // nom stocké avec prefix
        path: file.path
    }));

    const params = req.body;

    logToFile("Fichiers uploadés:", JSON.stringify(uploadedFiles, null, 2));
    logToFile('Params:', JSON.stringify(params, null, 2));

    res.json({
        message: 'Fichiers et paramètres envoyés avec succès',
        files: uploadedFiles,
        params: params
    });
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


// .___________.  ______     ______    __       __  ___  __ .___________.
// |           | /  __  \   /  __  \  |  |     |  |/  / |  | |        |
// `---|  |----`|  |  |  | |  |  |  | |  |     |  '  /  |  | `---|  |----`
//     |  |     |  |  |  | |  |  |  | |  |     |    <   |  |  |  |
//     |  |     |  `--'  | |  `--'  | |  `----.|  .  \  |  |  |  |
//     |__|      \______/   \______/  |_______||__|\__\ |__|  |__|

    //repertoire de travail pour toolkit

    const toolkitWorkingPath = '/opt/www/synflow.southgreen.fr/prod/tmp/toolkit_run/';
    const toolkitAnalysisDir = toolkitWorkingPath + 'toolkit_' + socket.id +'/';
    //create and check dir
    try {
        fs.mkdirSync(toolkitAnalysisDir);
        logToFile(`Répertoire d'analyse créé : ${toolkitAnalysisDir}`, socket.id);
    } catch (err) {
        if (err.code !== 'EEXIST') {
            throw err;
        }
    }

    const { exec } = require('child_process');
    const { spawn } = require('child_process');
    const path = require('path');  // Utilisé pour extraire le nom de fichier






    // Récupérer les fichiers de sortie dans le repertoire d'analyse
    // paramètre : toolkitID (ex: toolkit_123456789)
    socket.on('getToolkitFiles', (toolkitID) => {
        logToFile('Getting toolkit files for ID:', toolkitID, socket.id);
        const dir = toolkitWorkingPath +'/'+ toolkitID + '/';
        //recupère la liste des fichiers dans le repertoire d'analyse
        fs.readdir(dir, (err, files) => {
            if (err) {
                console.error(`Erreur lors de la lecture du répertoire : ${err}`);
                socket.emit('consoleMessage', `Erreur lors de la lecture du répertoire : ${err}`);
                return;
            }
            logToFile(`Fichiers dans le répertoire d'analyse : ${files}`, socket.id);
            // Filtrer les fichiers pour ne garder que ceux qui ont l'extension .out
            // Liste des extensions d'intérêt
            const validExtensions = ['.out', '.bed', '.anchors'];

            const outputFiles = files.filter(file =>
                validExtensions.some(ext => file.endsWith(ext))
            );
            if (outputFiles.length > 0) {
                // Si des fichiers de sortie sont trouvés, les envoyer au client
                const outputFilePaths = outputFiles.map(file => path.join(dir, file));
                logToFile(`Fichiers de sortie trouvés : ${outputFilePaths}`, socket.id);
                socket.emit('toolkitFilesResults', outputFilePaths);
            } else {
                logToFile('Aucun fichier de sortie trouvé.', socket.id);
                socket.emit('consoleMessage', 'Aucun fichier de sortie trouvé.');
            }
        });
    });


    // .______       __    __  .__   __.
    // |   _  \     |  |  |  | |  \ |  |
    // |  |_)  |    |  |  |  | |   \|  |
    // |      /     |  |  |  | |  . `  |
    // |  |\  \----.|  `--'  | |  |\   |
    // | _| `._____| \______/  |__| \__|

    // Gestion générique pour n'importe quel service

    socket.on('runService', (serviceName, serviceData, formData) => {
        logToFile(`[${getCurrentTimestamp()}] Lancement du service : ${serviceName}`, socket.id);
        logToFile('formData:', formData, socket.id);
        logToFile('serviceData:', serviceData, socket.id);
        logToFile(`service : ${serviceData.service}`, socket.id)

        // Récupérer les fichiers et les paramètres depuis la requête
        const uploadedFiles = formData.files;  // Les fichiers uploadés via multer
        const params = formData.params;        // Les paramètres texte (comme la base de données sélectionnée)
        let launchCommand ='';

        //   ______   .______      ___       __
        //  /  __  \  |   _  \    /   \     |  |
        // |  |  |  | |  |_)  |  /  ^  \    |  |
        // |  |  |  | |   ___/  /  /_\  \   |  |
        // |  `--'  | |  |     /  _____  \  |  `----.
        //  \______/  | _|    /__/     \__\ |_______|
        if(serviceData.service == "opal"){

            // Validation des paramètres pour éviter les injections de commandes
            function isSafeValue(value) {
                if (typeof value !== 'string' || value.length > 100 || value.length < 1) return false;
                // Métacaractères shell bloqués
                const dangerous = [';', '|', '&', '$', '`', '>', '<', '(', ')', '[', ']', '{', '}', '\\', '"', "'"];
                if (dangerous.some(char => value.includes(char))) return false;
                // Noms de fichiers suspects
                if (value.match(/[.*]{3,}/) || value.includes('..')) return false;  // ... ou ../
                return true;
            }

            Object.keys(params || {}).forEach(key => {
                if (!isSafeValue(params[key])) {
                    delete params[key];  // Supprime les valeurs dangereuses
                    logToFile(`Paramètre supprimé pour sécurité : ${key}`, socket.id);
                }
            });


            // Fonction pour construire la commande de lancement Opal
            function buildOpalLaunchCommand(serviceData, uploadedFiles, params) {
                const { url, action, arguments: argmts } = serviceData;
                const inputs = argmts.inputs;
                if (!inputs) {
                    throw new Error("Les 'inputs' ne sont pas définis pour ce service.");
                }

                //Construire -a en chaine unique pour Opal
                let aArgs = "";
                let filePaths = [];  // Tableau des chemins pour -f

                inputs.forEach(input => {
                    logToFile(`Traitement de l'input : ${input.name} de type ${input.type} avec flag ${input.flag}`, socket.id);
                    if (input.flag) {
                        if (input.type !== "file" && input.type !== "file[]") {
                            const value = params[input.name];
                            if (value && value !== "") {
                                aArgs += ` ${input.flag} ${value}`;
                            }
                        }
                    }
                    if (input.type === "file" || input.type === "file[]") {
                        const matchingFiles = uploadedFiles.filter(file => file.fieldname === input.name);
                        matchingFiles.forEach(file => {
                            if (file && file.path) {
                                filePaths.push(file.path);  // Collecte des chemins
                                const fileName = path.basename(file.path);
                                aArgs += ` ${input.flag} ${fileName}`;
                            }
                        });
                    }
                });

                // Construire tableau args pour execFile
                const args = [
                    '-r', action,
                    '-l', url
                ];

                if (aArgs.trim()) {
                    args.push('-a', aArgs.trim());  // ← Chaîne UNIQUE pour -a
                }

                // Ajouter TOUS les -f à la fin
                filePaths.forEach(filePath => {
                    args.push('-f', filePath);
                });

                return {
                    binary: 'python2',
                    args: ['/opt/OpalPythonClient/opal-py-2.4.1/GenericServiceClient.py', ...args]
                };
            }


            // Générer la commande
            const launchInfo = buildOpalLaunchCommand(serviceData, uploadedFiles, params);

            // __________   ___  _______   ______
            // |   ____\  \ /  / |   ____| /      |
            // |  |__   \  V  /  |  |__   |  ,----'
            // |   __|   >   <   |   __|  |  |
            // |  |____ /  .  \  |  |____ |  `----.
            // |_______/__/ \__\ |_______| \______|
            // Exécution sécurisée
            const { execFile } = require('child_process');
            execFile(launchInfo.binary, launchInfo.args, (error, stdout, stderr) => {
                logToFile(`Commande générée : ${launchInfo.binary} ${launchInfo.args.join(' ')}`, socket.id);
                socket.emit('consoleMessage', `${launchInfo.binary} ${launchInfo.args.join(' ')}`);

                if (error) {
                    logToFile(`Erreur d'exécution : ${error}`, socket.id);
                    socket.emit('consoleMessage', `Erreur : ${error}`);
                    return;
                }

                logToFile(`stdout: ${stdout}`, socket.id);
                socket.emit('consoleMessage', 'Lancement en cours...');
                socket.emit('consoleMessage', `Sortie :\n ${stdout}`);

                // Récupérer l'ID du job
                const jobIdMatch = stdout.match(/Job ID: (\S+)/);
                if (jobIdMatch && jobIdMatch[1]) {
                    const jobId = jobIdMatch[1];
                    socket.emit('consoleMessage', `Job lancé avec ID: ${jobId}`);

                    //verifie le fichier de log pour récupérer les sortie quand elle sont disponibles.
                    const logURL = 'http://io-biomaj.meso.umontpellier.fr:8080/opal-jobs/'+ jobId+'/stdout.txt';
                    logToFile(`URL du log à surveiller : ${logURL}`, socket.id);

                    //revoie toolkitAnalysisDir au client pour générer une url d'accès aux resultats
                    socket.emit('toolkitPath', toolkitAnalysisDir);

                    let lastLogLength = 0; // Variable pour suivre la taille précédente du log

                    function waitForOutputFiles(logURL, outputExtensions, callback) {
                        const https = require('https');
                        const http = require('http');
                        const urlModule = require('url');
                        const urlObj = urlModule.parse(logURL);

                        let lastLogLength = 0;

                        function checkLog() {

                            const lib = urlObj.protocol === 'https:' ? https : http;
                            lib.get(logURL, res => {
                                let data = '';
                                res.on('data', chunk => data += chunk);
                                res.on('end', () => {
                                    if (res.statusCode === 404) {
                                        setTimeout(checkLog, 500);
                                        return;
                                    }
                                    if (data.length > lastLogLength) {
                                        const newContent = data.substring(lastLogLength);
                                        lastLogLength = data.length;
newContent.split('\n').forEach(line => {
                                            if (line.trim() !== '') {
logToFile(`${line}`, socket.id);
socket.emit('consoleMessage', `${line}`);
                                            }
                                        });
                                    }

                                    //Chercher la section "Checking expected output files:"
                                    const outputSection = data.split('\n').find(line =>
                                        line.includes("Checking expected output files:")
                                    );

                                    if (outputSection) {
                                        // Filtrer toutes les extensions demandées
                                        const fileLines = data.split('\n').filter(line =>
outputExtensions.some(ext => line.trim().endsWith(ext))
                                        );

                                        logToFile(`Fichiers trouvés :`, fileLines, socket.id);

                                        if (fileLines.length > 0) {
                                            callback(null, fileLines);
                                        } else {
                                            logToFile("Aucun fichier trouvé malgré la section de sortie", socket.id);
socket.emit('consoleMessage', `No output files found.`);
                                            callback('No output files found');
                                        }
                                    } else if (data.includes('Snakemake pipeline failed')) {
socket.emit('consoleMessage', `${jobId} Pipeline failed, no output.`);
                                        callback('Pipeline failed');
                                    } else {
                                        setTimeout(checkLog, 500);
                                    }
                                });
                            }).on('error', err => {
                                callback(err);
                            });
                        }

                        checkLog();
                    }

                    //   ______    __    __  .___________..______   __    __  .___________.
                    //  /  __  \  |  |  |  | |           ||   _ \  |  |  |  | |           |
                    // |  |  |  | |  |  |  | `---|  |----`|  |_) | |  |  |  | `---|  |----`
                    // |  |  |  | |  |  |  |     |  |     |  ___/  |  |  |  |     |  |
                    // |  `--'  | |  `--'  |     |  |     |  |   |  `--'  |     |  |
                    //  \______/   \______/      |__|     | _|    \______/      |__|
                    // Surveille stdout.txt jusqu'à trouver tous les fichiers .out, .bed et .anchors
                    waitForOutputFiles(logURL, ['.out', '.bed', '.anchors'], (err, foundFiles) => {
                        if (err) {
                            logToFile('Error while monitoring log:', err, socket.id);
                            socket.emit('consoleMessage', `Error while monitoring log: ${err.message}`);
                            return;
                        }

                        if (foundFiles && foundFiles.length > 0) {
                            logToFile(`[${getCurrentTimestamp()}] Outputs found: ${foundFiles.length}`, socket.id);
                            socket.emit('consoleMessage', `Found ${foundFiles.length} output file(s).`);

                            foundFiles.forEach((fileName, index) => {
                                fileName = fileName.trim();
                                const outputFileUrl = `http://io-biomaj.meso.umontpellier.fr:8080/opal-jobs/${jobId}/${fileName}`;
                                logToFile(`Downloading output file: ${outputFileUrl}`, socket.id);

                                const newFileName = `${toolkitAnalysisDir}${fileName}`;
                                const downloadCommand = `curl -o ${newFileName} ${outputFileUrl}`;

                                exec(downloadCommand, (error, stdout, stderr) => {
                                    if (error) {
                                        logToFile(`Error while downloading ${fileName}: ${stderr}`, socket.id);
socket.emit('consoleMessage', `Error while downloading ${fileName}: ${stderr}`);
                                        return;
                                    }

                                    logToFile(`File downloaded: ${newFileName}`, socket.id);
                                    socket.emit('consoleMessage', `File downloaded: ${newFileName}`);
socket.emit('outputResultOpal', newFileName);
                                });
                            });
                        }
                    });

                } else {
                    socket.emit('consoleMessage', "Impossible de récupérer l'ID du job.");
                }
            });


        //   _______      ___       __          ___      ___   ___ ____    ____
        //  /  _____|    /   \     |  |        /   \     \  \ /  / \   \  /   /
        // |  |  __     /  ^  \    |  |       /  ^  \     \  V  /  \   \/   /
        // |  | |_ |   /  /_\  \   |  |      /  /_\  \     >  <     \_    _/
        // |  |__| |  /  _____  \  |  `----./  _____  \   /  .  \     |  |
        //  \______| /__/     \__\ |_______/__/     \__\ /__/ \__\     |__|
        }else if(serviceData.service == "galaxy"){
            // Fonction pour construire la commande de lancement Galaxy
            function buildGalaxyLaunchCommand(serviceData, uploadedFiles, params){
                const { command, arguments: argmts } = serviceData;
                const inputs = argmts.inputs;

                if (!inputs) {
                    throw new Error("Les 'inputs' ne sont pas définis pour ce service.");
                }

                let commandArgs = `${command} --outdir ${toolkitAnalysisDir}`;
                let args = "";


                // Parcourir les inputs et classer les arguments entre -a et -f
                inputs.forEach(input => {
                    if (input.flag) {
                        // Si c'est pas un fichier
                        if (input.type !== "file") {
                            const value = params[input.name];  // Récupérer la valeur du paramètre
                            if (value && value !== "") {
                                args += ` ${input.flag} ${value}`;
                            }
                        }
                    }

                    // Si c'est un fichier, ajouter à la liste avec son nouveau path uploadé
                    if (input.type === "file") {
                        const uploadedFile = uploadedFiles.find(file => file.fieldname === input.name);  // Récupérer le fichier uploadé
                        if (uploadedFile && uploadedFile.path) {
                            args += ` --${uploadedFile.fieldname} ${uploadedFile.path}`;  // Utiliser le chemin complet du fichier
                        }
                    }
                });

                // Ajout du bloc -a avec les arguments appropriés entre guillemets
                if (args) {
                    commandArgs += ` ${args.trim()}`;
                }

                // Retourner la commande complète
                return `${commandArgs.trim()}`;
            }

            launchCommand = buildGalaxyLaunchCommand(serviceData, uploadedFiles, params);
            logToFile(`Commande générée : ${launchCommand}`, socket.id);
            socket.emit('consoleMessage', launchCommand);

            // Diviser la commande et ses arguments
            const [command, ...args] = launchCommand.split(' ');
            const process = spawn(command, args);

            process.stdout.on('data', (data) => {
                logToFile(`stdout: ${data}`, socket.id);
                socket.emit('consoleMessage', `${data}`);
            });

            process.stderr.on('data', (data) => {
                logToFile(`stderr: ${data}`, socket.id);
                socket.emit('consoleMessage', `Erreur :\n ${data}`);
            });

            process.on('close', (code) => {
                logToFile(`Processus terminé avec le code ${code}`, socket.id);
                const newFileName = toolkitAnalysisDir+'ref_querry.out';
                fs.rename(toolkitAnalysisDir+'syri.out', newFileName, (err) => {
                    if (err) {
                        logToFile('Erreur lors du renommage du fichier:', err, socket.id);
                        socket.emit('consoleMessage', `Erreur lors du renommage du fichier: ${err.message}`);
                        return;
                    }
                    logToFile('Rename complete!', socket.id);
                    socket.emit('consoleMessage', `Processus terminé avec le code ${code}`);
                    socket.emit('outputResult', newFileName);
                });
            });
        }
    });



//      _______.____    ____ .__   __.  _______  __        ______  ____    __    ____
//     /       |\   \  /   / |  \ |  | |   ____||  |      /  __ \  \   \  /  \  /   /
//    |   (----` \   \/   /  |   \|  | |  |__   |  |     |  |  | |  \   \/    \/   /
//     \   \      \_    _/   |  . `  | |   __|  |  |     |  |  | |   \            /
// .----)   |       |  |     |  |\   | |  |     |  `----.|  `--' |    \    /\    /
// |_______/        |__|     |__| \__| |__|     |_______| \______/      \__/  \__/
    // socket.on('runSyri', (data) => {
    //     console.log(`[${getCurrentTimestamp()}] Lancement du pipeline SyRi`);

    //     //execute la commande opal
    //     const launchCommand = `python2 /opt/OpalPythonClient/opal-py-2.4.1/GenericServiceClient.py -l http://io-biomaj.meso.umontpellier.fr:8080/opal2/services/synflow -r launchJob -a "-i C21.fasta -i DH.fasta" -f /NAS/muse/web/HUBs/coffea/opal/C21.fasta -f /NAS/muse/web/HUBs/coffea/opal/DH.fasta`;
    //     const { exec } = require("child_process");
    //     exec(launchCommand, (error, stdout, stderr) => {
    //         if (error) {
    //             console.error(`Erreur d'exécution : ${error}`);
    //             socket.emit('consoleMessage', `Erreur : ${error}`);
    //             return;
    //         }

    //         console.log(`stdout: ${stdout}`);
    //         socket.emit('[${getCurrentTimestamp()}] consoleMessage', 'Lancement en cours...');
    //         socket.emit('[${getCurrentTimestamp()}] consoleMessage', `Sortie :\n ${stdout}`);

    //         // Récupérer l'ID du job
    //         const jobIdMatch = stdout.match(/Job ID: (\S+)/);
    //         if (jobIdMatch && jobIdMatch[1]) {
    //             const jobId = jobIdMatch[1];
    //             socket.emit('consoleMessage', `Job lancé avec ID: ${jobId}`);

    //             // Vérification périodique du statut
    //             const checkJobStatus = setInterval(() => {
    //                 const statusCommand = `python2 /opt/OpalPythonClient/opal-py-2.4.1/GenericServiceClient.py -l http://io-biomaj.meso.umontpellier.fr:8080/opal2/services/synflow -r queryStatus -j ${jobId}`;
    //                 exec(statusCommand, (error, stdout, stderr) => {
    //                     if (error) {
    //                         console.error(`Erreur lors de la vérification du statut : ${stderr}`);
    //                         socket.emit('consoleMessage', `Erreur lors de la vérification du statut : ${stderr}`);
    //                         clearInterval(checkJobStatus); // Arrêter la vérification en cas d'erreur
    //                         return;
    //                     }
    //                     console.log(`[${getCurrentTimestamp()}] Statut du job : ${stdout}`);
    //                     socket.emit('consoleMessage', `[${getCurrentTimestamp()}] Statut du job : ${stdout}`);

    //                     // Arrêter la vérification si le job est terminé (par exemple si le statut est "Done")
    //                     if (stdout.includes("Code: 8") || stdout.includes("Job terminé")) {
    //                         socket.emit('consoleMessage', 'Job terminé.');
    //                         clearInterval(checkJobStatus); // Arrêter la vérification

    //                         // Récupérer les fichiers de sortie après avoir reçu le statut DONE
    //                         const outputCommand = `python2 /opt/OpalPythonClient/opal-py-2.4.1/GenericServiceClient.py -l http://io-biomaj.meso.umontpellier.fr:8080/opal2/services/synflow -r getOutputs -j ${jobId}`;
    //                         exec(outputCommand, (error, stdout, stderr) => {
    //                             if (error) {
    //                                 console.error(`Erreur lors de la récupération des fichiers de sortie : ${stderr}`);
    //  socket.emit('consoleMessage', `Erreur lors de la récupération des fichiers de sortie : ${stderr}`);
    //                                 return;
    //                             }
    //                             console.log(`Fichiers de sortie : ${stdout}`);
    //                             socket.emit('consoleMessage', `Fichiers de sortie :\n ${stdout}`);
    //                             /////////
    //                         });

    //                     }
    //                 });
    //             }, 5000); // Vérification toutes les 5 secondes

    //         } else {
    //             socket.emit('consoleMessage', 'Impossible de récupérer l\'ID du job.');
    //         }
    //     });
    // });




//   _______  _______ .___  ___.   ______
//  /  _____||   ____||   \/   |  /  __  \
// |  |  __  |  |__   |  \  /  | |  |  |  |
// |  | |_ | |   __|  |  |\/|  | |  |  |  |
// |  |__| | |  |____ |  |  |  | |  `--'  |
//  \______| |_______||__|  |__|  \______/

    ///////////////////////////////////////
    //Gestion des repertoire d'analyse
    ///////////////////////////////////////





    ///CARAMY - commenté pour nouveau deploiement

    // const progPath = '/opt/www/gemo.southgreen.fr/prod/python/';
    //     const workingPath = '/opt/www/gemo.southgreen.fr/prod/tmp/gemo_run/';
    //     const analysisDir = workingPath + 'gemo_' + socket.id +'/';
    // fs.mkdirSync(analysisDir);


    //run chrom config
        socket.on('run', (tsv, callback) => {
                logToFile("run tsv", socket.id);

        //upload le tsv dans les fichier temp avec uniq id
        fs.writeFile(analysisDir+'musa-acuminata.tsv', tsv, {encoding:'utf8', flag : 'w+' }, function (err) {
            //err
            if (err) return logToFile("error write file "+err, socket.id);

            //success
            logToFile("musa-acuminata.tsv uploaded to : "+analysisDir, socket.id);

            //go to analysis directory
            try {
                process.chdir(analysisDir);
                logToFile(`New directory: ${process.cwd()}`, socket.id);
            } catch (err) {
                logToFile(`chdir: ${err}`, socket.id);
            }

            const { exec } = require("child_process");
            exec(`python3 ${progPath}convert_band_data_socket.py`, (error, stdout, stderr) => {
                logToFile(`python ${progPath}convert_band_data_socket.py`, socket.id);
                if (error) {
                    logToFile(`exec error: ${error}`, socket.id);
                }
                logToFile(`stdout: ${stdout}`, socket.id);
                callback(null, socket.id);
            });

                });
        });


    socket.on ( "gff" , (annot, color, ploidy, callback) => {
        logToFile("gff", socket.id);

        //genère un ID
        var date = new Date();
        var components = [
            date.getYear(),
            date.getMonth(),
            date.getDate(),
            date.getHours(),
            date.getMinutes(),
            date.getSeconds(),
            date.getMilliseconds()
        ];
        var id = components.join("");

        //cree un repertoire uniq pour les gff
        fs.mkdirSync(id);

        //enregistre les fichiers necessaires au script
        fs.writeFile(analysisDir+id+'/annot.txt', annot.join("\n"), {encoding:'utf8', flag : 'w+' }, function (err) {
            //err
            if (err) return logToFile("error write file "+err, socket.id);
            logToFile(analysisDir+id+'/annot.txt saved', socket.id);
        });

        //enregistre les fichiers necessaires au script
        fs.writeFile(analysisDir+id+'/color.txt', color, {encoding:'utf8', flag : 'w+' }, function (err) {
            //err
            if (err) return logToFile("error write file "+err, socket.id);
            logToFile(analysisDir+id+'/color.txt saved', socket.id);
        });

        //cree les gff

        const { exec } = require("child_process");
        exec(`perl ${progPath}gemo2gff.pl ${ploidy} ${id}/annot.txt ${id}/color.txt ${id}/`, (error, stdout, stderr) => {
            logToFile(`${progPath}gemo2gff.pl ${id}/annot.txt ${id}/color.txt ${id}/`, socket.id);
            if (error) {
                logToFile(`exec error: ${error}`, socket.id);
            }
            logToFile(`stdout: ${stdout}`, socket.id);

            let trackURL ="";
            let addStores ="&addStores={";
            let addTracks ="&addTracks=[";
            let index =0;
            let first = true;
            //pour chaque gff generé
            fs.readdir(id, (err, files) => {
                if (err)
                    logToFile(err, socket.id);
                else {
                    logToFile("\nCurrent gff files:", socket.id);
                    files.forEach(file => {
                        if(file.match(/gff/)){
                            logToFile(file, socket.id);
                            if(!first){
                                addStores += ",";
                                addTracks += ",";
                            }
                            addStores += "\"url"+index+"\":{\"type\":\"JBrowse/Store/SeqFeature/GFF3\",\"urlTemplate\":\"https://gemo.southgreen.fr/tmp/gemo_run/gemo_"+socket.id+"/"+id+"/"+file+"\"}";
                            addTracks += "{\"label\":\"gemo"+index+"\",\"type\":\"JBrowse/View/Track/CanvasFeatures\",\"store\":\"url"+index+"\",\"style\":{\"color\":\"function(feature){return feature.get('color')}\"}}";
                            index ++;
                            first = false;
                        }
                    });
                    addStores += "}";
                    addTracks += "]";
                    trackURL = addStores + addTracks;
                    logToFile(trackURL, socket.id);
                    callback(null, trackURL);
                }
            });
        });
    });
    socket.on('saveAsURL', (annot, chrom, color, ploidy, callback) => {
                logToFile("save as url", socket.id);
        //genère un ID
        var date = new Date();
        var components = [
            date.getYear(),
            date.getMonth(),
            date.getDate(),
            date.getHours(),
            date.getMinutes(),
            date.getSeconds(),
            date.getMilliseconds()
        ];
        var id = components.join("");

        const savedDir = '/opt/www/gemo.southgreen.fr/prod/tmp/gemo_saved/gemo_' + id +'/';

        //copy directory to saved location
        /**
         * Look ma, it's cp -R.
         * @param {string} src  The path to the thing to copy.
         * @param {string} dest The path to the new copy.
         */
        var copyRecursiveSync = function(src, dest) {
            var exists = fs.existsSync(src);
            var stats = exists && fs.statSync(src);
            var isDirectory = exists && stats.isDirectory();
            if (isDirectory) {
            fs.mkdirSync(dest);
            fs.readdirSync(src).forEach(function(childItemName) {
                copyRecursiveSync(path.join(src, childItemName),
                                path.join(dest, childItemName));
            });
            } else {
            fs.copyFileSync(src, dest);
            }
        };
        //copie le repertoire d'analyse dans un repertoire sauvegardé
        copyRecursiveSync(analysisDir, savedDir);
        //enregistre les fichiers annot chrom et color

        fs.writeFile(savedDir+'annot.txt', annot, {encoding:'utf8', flag : 'w+' }, function (err) {
            //err
            if (err) return logToFile("error write file "+err, socket.id);
            logToFile(savedDir+'annot.txt saved', socket.id);
        });
        fs.writeFile(savedDir+'chrom.txt', chrom, {encoding:'utf8', flag : 'w+' }, function (err) {
            //err
            if (err) return logToFile("error write file "+err, socket.id);
            logToFile(savedDir+'chrom.txt saved', socket.id);
        });
        fs.writeFile(savedDir+'color.txt', color, {encoding:'utf8', flag : 'w+' }, function (err) {
            //err
            if (err) return logToFile("error write file "+err, socket.id);
            logToFile(savedDir+'color.txt saved', socket.id);
        });
        fs.writeFile(savedDir+'ploidy.txt', ploidy, {encoding:'utf8', flag : 'w+' }, function (err) {
            //err
            if (err) return logToFile("error write file "+err, socket.id);
            logToFile(savedDir+'ploidy.txt saved', socket.id);
        });
        callback(null, id);
        });

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
        // rimraf(workingPath);
        // rimraf(toolkitWorkingPath);//enlève aussi les fichiers temporaires du toolkit
    });
});