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

// Validation du contenu réel d'un fichier uploadé
// Vérifie que les premiers octets correspondent au format attendu (par extension)
function validateFileContent(filePath, originalName) {

    //Vérif originalName
    if (!originalName || typeof originalName !== 'string') {
        logToFile(`Rejet: originalName manquant (${originalName})`);
        return false;
    }
    
    const ext = path.extname(originalName).toLowerCase();
    
    let head;
    try {
        const fd = fs.openSync(filePath, 'r');
        const buf = Buffer.alloc(4096);
        const bytesRead = fs.readSync(fd, buf, 0, 4096, 0);
        fs.closeSync(fd);
        head = buf.toString('utf8', 0, bytesRead);
    } catch (e) {
        logToFile(`Erreur lecture head ${originalName}: ${e.message}`, uploadId);
        return false;
    }

    // Patterns dangereux
    const dangerousPatterns = /<script|javascript:|eval\s*\(|import\s+|require\s*\(|exec\s*\(/i;
    if (dangerousPatterns.test(head)) {
        logToFile(`Rejet malveillant: ${originalName}`, uploadId);
        return false;
    }

    const trimmed = head.trim();

    switch (ext) {
        case '.fasta': case '.fa': case '.fna': case '.faa':
            if (!/^>/.test(trimmed)) return false;
            break;
        case '.gff': case '.gff3':
            if (!/^(##gff-version|#)/.test(trimmed) && !/^\S+\t\S+\t/.test(trimmed)) return false;
            break;
        case '.bed': case '.tsv': case '.txt':
            {
                const lines = trimmed.split('\n').filter(l => l.trim() && !l.startsWith('#'));
                if (lines.length > 0 && !lines[0].includes('\t')) return false;
            }
            break;
        case '.json':
            try { JSON.parse(fs.readFileSync(filePath, 'utf8')); }
            catch { return false; }
            break;
        case '.anchors': case '.out':
            break;  // OK par défaut
    }
    return true;
}


// Configuration multer Synflow
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, toolkitWorkingPath);
    },
	filename: function (req, file, cb) {
		const prefix = req.uploadId || Date.now();
		
		// Protection originalname
		const safeName = (file.originalname || 'unknown')
			.replace(/[^a-zA-Z0-9._-]/g, '_')
			.substring(0, 100);
		
		cb(null, `${prefix}_${safeName}`);
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

		const allowedUploadExtensions = ['.txt', '.fasta', '.tsv', '.bed', '.gff', '.gff3','.out', '.anchors', '.fa', '.fna', '.faa', '.json'];

		const ext = path.extname(file.originalname).toLowerCase();
		if (!allowedUploadExtensions.includes(ext)) {
            return cb(new Error(`Extension non autorisée: ${ext}`), false);
        }
        // Bloquer les noms de fichier contenant des caractères dangereux
        if (/[;\n\r`$|&<>(){}\\]/.test(file.originalname)) {
            return cb(new Error('Nom de fichier invalide'), false);
        }
        cb(null, true);
    }
});

// Route POST /upload Synflow
uploadRouter.post('/upload', assignUploadId, upload.any(), (req, res) => {

	// Validation du contenu de chaque fichier uploadé
    const rejected = [];
    for (const file of req.files) {
        if (!validateFileContent(file.path, file.originalname)) {
            rejected.push(file.originalname);
            // Supprimer le fichier rejeté du disque
            try { fs.unlinkSync(file.path); } catch { /* ignore */ }
        }
    }
    if (rejected.length > 0) {
        // Supprimer aussi les fichiers valides de ce lot (tout ou rien)
        for (const file of req.files) {
            try { fs.unlinkSync(file.path); } catch { /* already deleted or ignore */ }
        }
        return res.status(400).json({
            error: `Contenu invalide pour : ${rejected.join(', ')}. Formats attendus : FASTA, GFF3, BED, TSV, JSON, etc.`
        });
    }

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


//Error handler Multer + Socket.IO
uploadRouter.use((error, req, res, next) => {
    if (!req.uploadId) {
        req.uploadId = Date.now() + '-' + Math.round(Math.random() * 1E9);
    }
    
    // Multer errors (taille, type, etc.)
    if (error instanceof multer.MulterError) {
        const messages = {
            'LIMIT_FILE_SIZE': 'File too large (max 500MB)',
            'LIMIT_FILE_COUNT': 'Too many files (max 20)',
            'LIMIT_FIELD_SIZE': 'Text parameters too long',
            'LIMIT_UNEXPECTED_FILE': 'Unexpected file type'
        };
        
        const message = messages[error.code] || `Multer error: ${error.code}`;
        
        logToFile(`Multer error ${error.code}: ${message}`, req.uploadId);
        
        // Note: req.socket n'existe pas, on utilise une approche différente
        res.status(400).json({
            error: 'Upload failed',
            message: message,
            uploadId: req.uploadId
        });
        return;
    }
    
    // Erreurs validateFileContent
    if (error.message && error.message.includes('Invalid content')) {
        logToFile(`Invalid content: ${error.message}`, req.uploadId);
        res.status(400).json({
            error: 'Invalid content',
            message: error.message,
            uploadId: req.uploadId
        });
        return;
    }
    
    // Autres erreurs
    logToFile(`Upload error: ${error.message}`, req.uploadId);
    res.status(500).json({
        error: 'Server error',
        message: error.message,
        uploadId: req.uploadId
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
	
	if (!uploadedFiles || !Array.isArray(uploadedFiles)) {
        logToFile('ERROR: no uploaded files or invalid format', socket.id);
        socket.emit('consoleMessage', 'Error: no uploaded files or invalid format.');
        return;
    }

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
