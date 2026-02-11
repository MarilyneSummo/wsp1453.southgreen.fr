const fs = require('fs');
const { exec, execFile, spawn } = require('child_process');
const path = require('path');
const http = require('http');
const https = require('https');
const urlModule = require('url');
const express = require('express'); 
const multer = require('multer');
const { logToFile, getCurrentTimestamp } = require('../utils/logger');

const toolkitWorkingPath = '/opt/www/synflow.southgreen.fr/prod/tmp/toolkit_run/';
const uploadRouter = express.Router();

// Middleware assignUploadId
function assignUploadId(req, res, next) {
    if (!req.uploadId) {
        req.uploadId = Date.now() + '-' + Math.round(Math.random() * 1E9);
    }
    next();
}

// Configuration multer Synflow
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, toolkitWorkingPath);
    },
    filename: function (req, file, cb) {
        const prefix = req.uploadId || Date.now();
        
        //Sanitise originalname
        let safeName = path.basename(file.originalname);  // enlève /../
        safeName = safeName.replace(/[^a-zA-Z0-9_\-\.]/g, '_');  // remplace caractères dangereux
        
        //Extension préservée mais sûre
        const ext = path.extname(safeName);
        const name = path.basename(safeName, ext).substring(0, 50);  // max 50 chars
        
        cb(null, `${prefix}_${name}${ext}`);
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 500 * 1024 * 1024,  // 500MB max
        files: 20,                    // max 20 fichiers
        fieldSize: 10 * 1024          // 10KB max champ texte
    },
    fileFilter: (req, file, cb) => {
        //Seulement tes extensions
        const allowed = /\.(out|bed|anchors|fasta|fastq|gff|json)$/i;
        if (allowed.test(file.originalname)) {
            cb(null, true);
        } else {
			logToFile(`Rejet fichier ${file.originalname} type ${file.mimetype}`, req.uploadId);
            cb(new Error(`File type ${file.mimetype} not allowed`), false);
        }
    }
});

// Route POST /upload Synflow
uploadRouter.post('/upload', assignUploadId, upload.any(), (req, res) => {
    //Vérifie paths finaux
    const uploadedFiles = req.files.map(file => {
        const resolvedPath = path.resolve(file.path);
        if (!resolvedPath.startsWith(toolkitWorkingPath)) {
            fs.unlinkSync(file.path);  // Supprime fichier suspect
            return null;
        }
        return {
            fieldname: file.fieldname,
            originalname: file.originalname,
            filename: file.filename,
            path: file.path,
            size: file.size
        };
    }).filter(Boolean);  // Enlève fichiers suspects

    const params = req.body;
    
    //Log + réponse
    logToFile("Fichiers uploadés:", JSON.stringify(uploadedFiles, null, 2));
    logToFile('Params:', JSON.stringify(params, null, 2));
	
    res.json({
        success: true,
        message: 'Fichiers envoyés avec succès',
        files: uploadedFiles,
        params: params,
        rejected: req.files.length - uploadedFiles.length
    });
});



module.exports = {
	router: uploadRouter,  // ← Route /upload exportée
	attachHandlers: function(socket, toolkitAnalysisDir) {
    // getToolkitFiles (code original)
    socket.on('getToolkitFiles', (toolkitID) => {
      logToFile('Getting toolkit files for ID: ' + toolkitID, socket.id);
      const dir = toolkitWorkingPath + '/' + toolkitID + '/';
      
      fs.readdir(dir, (err, files) => {
        if (err) {
          logToFile(`Erreur lecture dir: ${err}`, socket.id);
          socket.emit('consoleMessage', `Erreur: ${err}`);
          return;
        }
        logToFile(`Fichiers: ${files}`, socket.id);
        
        const validExtensions = ['.out', '.bed', '.anchors'];
        const outputFiles = files.filter(file => 
          validExtensions.some(ext => file.endsWith(ext))
        );
        
        if (outputFiles.length > 0) {
          const outputFilePaths = outputFiles.map(file => path.join(dir, file));
          logToFile(`Sortie trouvée: ${outputFilePaths}`, socket.id);
          socket.emit('toolkitFilesResults', outputFilePaths);
        } else {
          logToFile('Aucun fichier sortie', socket.id);
          socket.emit('consoleMessage', 'Aucun fichier de sortie trouvé.');
        }
      });
    });

    // runService principal
    socket.on('runService', (serviceName, serviceData, formData) => {
      logToFile(`[${getCurrentTimestamp()}] Lancement du service : ${serviceName}`, socket.id);
      logToFile('formData:', formData, socket.id);
      logToFile('serviceData:', serviceData, socket.id);

      const uploadedFiles = formData.files;
      const params = formData.params;

      if (serviceData.service === 'opal') {
        this.handleOpal(socket, serviceData, uploadedFiles, params, toolkitAnalysisDir);
      } else if (serviceData.service === 'galaxy') {
        this.handleGalaxy(socket, serviceData, uploadedFiles, params, toolkitAnalysisDir);
      }
    });
  },

  handleOpal(socket, serviceData, uploadedFiles, params, toolkitAnalysisDir) {
    // Validation sécurité (code original)
    function isSafeValue(value) {
      if (typeof value !== 'string' || value.length > 100 || value.length < 1) return false;
      const dangerous = [';', '|', '&', '$', '`', '>', '<', '(', ')', '[', ']', '{', '}', '\\', '"', "'"];
      if (dangerous.some(char => value.includes(char))) return false;
      if (value.match(/[.*]{3,}/) || value.includes('..')) return false;
      return true;
    }

    Object.keys(params || {}).forEach(key => {
      if (!isSafeValue(params[key])) {
        delete params[key];
        logToFile(`Paramètre supprimé sécurité: ${key}`, socket.id);
      }
    });

    // buildOpalLaunchCommand (code original)
    function buildOpalLaunchCommand(serviceData, uploadedFiles, params) {
      const { url, action, arguments: argmts } = serviceData;
      const inputs = argmts.inputs;
      if (!inputs) throw new Error("Les 'inputs' ne sont pas définis");

      let aArgs = "";
      let filePaths = [];

      inputs.forEach(input => {
        logToFile(`Input: ${input.name} type ${input.type} flag ${input.flag}`, socket.id);
        if (input.flag) {
          if (input.type !== "file" && input.type !== "file[]") {
            const value = params[input.name];
            if (value && value !== "") aArgs += ` ${input.flag} ${value}`;
          }
        }
        if (input.type === "file" || input.type === "file[]") {
          const matchingFiles = uploadedFiles.filter(file => file.fieldname === input.name);
          matchingFiles.forEach(file => {
            if (file && file.path) {
              filePaths.push(file.path);
              const fileName = path.basename(file.path);
              aArgs += ` ${input.flag} ${fileName}`;
            }
          });
        }
      });

      const args = ['-r', action, '-l', url];
      if (aArgs.trim()) args.push('-a', aArgs.trim());
      filePaths.forEach(filePath => args.push('-f', filePath));

      return {
        binary: 'python2',
        args: ['/opt/OpalPythonClient/opal-py-2.4.1/GenericServiceClient.py', ...args]
      };
    }

    // Exécution
    const launchInfo = buildOpalLaunchCommand(serviceData, uploadedFiles, params);
    logToFile(`Commande: ${launchInfo.binary} ${launchInfo.args.join(' ')}`, socket.id);
    socket.emit('consoleMessage', `${launchInfo.binary} ${launchInfo.args.join(' ')}`);

    execFile(launchInfo.binary, launchInfo.args, (error, stdout, stderr) => {
      if (error) {
        logToFile(`Erreur exec: ${error}`, socket.id);
        socket.emit('consoleMessage', `Erreur: ${error}`);
        return;
      }

      logToFile(`stdout: ${stdout}`, socket.id);
      socket.emit('consoleMessage', 'Lancement en cours...');
      socket.emit('consoleMessage', `Sortie: ${stdout}`);

      const jobIdMatch = stdout.match(/Job ID: (\S+)/);
      if (jobIdMatch && jobIdMatch[1]) {
        const jobId = jobIdMatch[1];
        socket.emit('consoleMessage', `Job ID: ${jobId}`);
        socket.emit('toolkitPath', toolkitAnalysisDir);

        const logURL = `http://io-biomaj.meso.umontpellier.fr:8080/opal-jobs/${jobId}/stdout.txt`;
        logToFile(`Log URL: ${logURL}`, socket.id);

        this.waitForOutputFiles(socket, logURL, ['.out', '.bed', '.anchors'], jobId, toolkitAnalysisDir);
      } else {
        socket.emit('consoleMessage', "Pas d'ID job");
      }
    });
  },

  waitForOutputFiles(socket, logURL, outputExtensions, jobId, toolkitAnalysisDir) {
    let lastLogLength = 0;
    
    function checkLog() {
      const urlObj = urlModule.parse(logURL);
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

          const outputSection = data.split('\n').find(line => 
            line.includes("Checking expected output files:")
          );

          if (outputSection) {
            const fileLines = data.split('\n').filter(line =>
              outputExtensions.some(ext => line.trim().endsWith(ext))
            );

            logToFile(`Fichiers trouvés: ${fileLines}`, socket.id);
            
            if (fileLines.length > 0) {
              fileLines.forEach((fileName, index) => {
                fileName = fileName.trim();
                const outputFileUrl = `http://io-biomaj.meso.umontpellier.fr:8080/opal-jobs/${jobId}/${fileName}`;
                const newFileName = `${toolkitAnalysisDir}${fileName}`;
                const downloadCommand = `curl -o ${newFileName} ${outputFileUrl}`;

                exec(downloadCommand, (error, stdout, stderr) => {
                  if (error) {
                    logToFile(`Erreur download ${fileName}: ${stderr}`, socket.id);
                    socket.emit('consoleMessage', `Erreur download ${fileName}: ${stderr}`);
                  } else {
                    logToFile(`Fichier téléchargé: ${newFileName}`, socket.id);
                    socket.emit('consoleMessage', `Fichier OK: ${newFileName}`);
                    socket.emit('outputResultOpal', newFileName);
                  }
                });
              });
            } else {
              socket.emit('consoleMessage', 'Aucun fichier trouvé');
            }
          } else if (data.includes('Snakemake pipeline failed')) {
            socket.emit('consoleMessage', `${jobId} Pipeline failed`);
          } else {
            setTimeout(checkLog, 500);
          }
        });
      }).on('error', err => {
        logToFile('Erreur checkLog: ' + err, socket.id);
      });
    }
    
    checkLog();
  },

  handleGalaxy(socket, serviceData, uploadedFiles, params, toolkitAnalysisDir) {
    function buildGalaxyLaunchCommand(serviceData, uploadedFiles, params) {
      const { command, arguments: argmts } = serviceData;
      const inputs = argmts.inputs;
      if (!inputs) throw new Error("Inputs non définis");

      let commandArgs = `${command} --outdir ${toolkitAnalysisDir}`;
      let args = "";

      inputs.forEach(input => {
        if (input.flag && input.type !== "file") {
          const value = params[input.name];
          if (value && value !== "") args += ` ${input.flag} ${value}`;
        }
        if (input.type === "file") {
          const uploadedFile = uploadedFiles.find(file => file.fieldname === input.name);
          if (uploadedFile && uploadedFile.path) {
            args += ` --${uploadedFile.fieldname} ${uploadedFile.path}`;
          }
        }
      });

      if (args) commandArgs += args.trim();
      return commandArgs.trim();
    }

    const launchCommand = buildGalaxyLaunchCommand(serviceData, uploadedFiles, params);
    logToFile(`Commande Galaxy: ${launchCommand}`, socket.id);
    socket.emit('consoleMessage', launchCommand);

    const [command, ...args] = launchCommand.split(' ');
    const process = spawn(command, args);

    process.stdout.on('data', (data) => {
      logToFile(`stdout: ${data}`, socket.id);
      socket.emit('consoleMessage', `${data}`);
    });

    process.stderr.on('data', (data) => {
      logToFile(`stderr: ${data}`, socket.id);
      socket.emit('consoleMessage', `Erreur: ${data}`);
    });

    process.on('close', (code) => {
      logToFile(`Processus terminé code ${code}`, socket.id);
      const newFileName = toolkitAnalysisDir + 'ref_querry.out';
      fs.rename(toolkitAnalysisDir + 'syri.out', newFileName, (err) => {
        if (err) {
          logToFile('Erreur rename: ' + err, socket.id);
          socket.emit('consoleMessage', `Erreur rename: ${err.message}`);
        }
        socket.emit('consoleMessage', `Terminé code ${code}`);
        socket.emit('outputResult', newFileName);
      });
    });
  }
};
