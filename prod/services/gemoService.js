const fs = require('fs');
const { execFile } = require('child_process');
const path = require('path');
const { logToFile } = require('../utils/logger');

const progPath = '/opt/www/gemo.southgreen.fr/prod/python/';
const workingPath = '/opt/www/wsp1453.southgreen.fr/prod/tmp/gemo_run/';

module.exports = {
  attachHandlers(socket, analysisDir) {
    const realAnalysisDir = path.resolve(analysisDir || '/tmp/fallback/');
    
    socket.on('run', (tsv, callback) => {
      logToFile("run tsv", socket.id);
      
      fs.writeFile(path.join(realAnalysisDir, 'musa-acuminata.tsv'), tsv, {encoding:'utf8', flag : 'w+' }, function (err) {
        if (err) return logToFile("error write file "+err, socket.id);
        
        logToFile("musa-acuminata.tsv uploaded to : "+realAnalysisDir, socket.id);
        
        const pythonScript = path.join(progPath, 'convert_band_data_socket.py');
        execFile('python3', [pythonScript], { cwd: realAnalysisDir }, (error, stdout, stderr) => {
          logToFile(`execFile python3 ${pythonScript}`, socket.id);
          if (error) logToFile(`exec error: ${error}`, socket.id);
          if (stderr) logToFile(`stderr: ${stderr}`, socket.id);
          logToFile(`stdout: ${stdout}`, socket.id);
          callback(null, socket.id);
        });
      });
    });

    socket.on('gff', (annot, color, ploidy, callback) => {
      logToFile("gff", socket.id);
      
      var date = new Date();
      var components = [
        date.getYear(), date.getMonth(), date.getDate(),
        date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds()
      ];
      var id = components.join("");
      
      const idDir = path.join(realAnalysisDir, id);
      fs.mkdirSync(idDir);
      
      fs.writeFile(path.join(idDir, 'annot.txt'), annot.join("\n"), {encoding:'utf8', flag : 'w+' }, function (err) {
        if (err) return logToFile("error write file "+err, socket.id);
        logToFile(path.join(idDir, 'annot.txt') + ' saved', socket.id);
      });
      
      fs.writeFile(path.join(idDir, 'color.txt'), color, {encoding:'utf8', flag : 'w+' }, function (err) {
        if (err) return logToFile("error write file "+err, socket.id);
        logToFile(path.join(idDir, 'color.txt') + ' saved', socket.id);
      });
      
      const perlScript = path.join(progPath, 'gemo2gff.pl');
      const perlArgs = [String(ploidy), path.join(id, 'annot.txt'), path.join(id, 'color.txt'), `${id}/`];
      execFile('perl', [perlScript, ...perlArgs], { cwd: realAnalysisDir }, (error, stdout, stderr) => {
        logToFile(`execFile perl ${perlScript} ${perlArgs.join(' ')}`, socket.id);
        if (error) logToFile(`exec error: ${error}`, socket.id);
        if (stderr) logToFile(`stderr: ${stderr}`, socket.id);
        logToFile(`stdout: ${stdout}`, socket.id);
        
        let trackURL = "";
        let addStores = "&addStores={";
        let addTracks = "&addTracks=[";
        let index = 0;
        let first = true;
        
        fs.readdir(path.join(realAnalysisDir, id), (err, files) => {
          if (err) logToFile(err, socket.id);
          else {
            logToFile("\nCurrent gff files:", socket.id);
            files.forEach(file => {
              if(file.match(/gff/)){
                logToFile(file, socket.id);
                if(!first){ addStores += ","; addTracks += ","; }
                addStores += `"url${index}":{"type":"JBrowse/Store/SeqFeature/GFF3","urlTemplate":"https://gemo.southgreen.fr/tmp/gemo_run/gemo_${socket.id}/${id}/${file}"}`;
                addTracks += `{"label":"gemo${index}","type":"JBrowse/View/Track/CanvasFeatures","store":"url${index}","style":{"color":"function(feature){return feature.get('color')}"}}`;
                index++; first = false;
              }
            });
            addStores += "}"; addTracks += "]";
            trackURL = addStores + addTracks;
            logToFile(trackURL, socket.id);
            callback(null, trackURL);
          }
        });
      });
    });

    socket.on('saveAsURL', (annot, chrom, color, ploidy, callback) => {
      logToFile("save as url", socket.id);
      
      var date = new Date();
      var components = [date.getYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds()];
      var id = components.join("");
      
      const savedDir = '/opt/www/gemo.southgreen.fr/prod/tmp/gemo_saved/gemo_' + id + '/';
      
      const copyRecursiveSync = function(src, dest) {
        var exists = fs.existsSync(src);
        var stats = exists && fs.statSync(src);
        var isDirectory = exists && stats.isDirectory();
        if (isDirectory) {
          fs.mkdirSync(dest);
          fs.readdirSync(src).forEach(function(childItemName) {
            copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
          });
        } else {
          fs.copyFileSync(src, dest);
        }
      };
      
      copyRecursiveSync(realAnalysisDir, savedDir);
      
      fs.writeFile(savedDir+'annot.txt', annot, {encoding:'utf8', flag : 'w+' }, (err) => {
        if (err) logToFile("error write file "+err, socket.id);
        else logToFile(savedDir+'annot.txt saved', socket.id);
      });
      fs.writeFile(savedDir+'chrom.txt', chrom, {encoding:'utf8', flag : 'w+' }, (err) => {
        if (err) logToFile("error write file "+err, socket.id);
        else logToFile(savedDir+'chrom.txt saved', socket.id);
      });
      fs.writeFile(savedDir+'color.txt', color, {encoding:'utf8', flag : 'w+' }, (err) => {
        if (err) logToFile("error write file "+err, socket.id);
        else logToFile(savedDir+'color.txt saved', socket.id);
      });
      fs.writeFile(savedDir+'ploidy.txt', ploidy, {encoding:'utf8', flag : 'w+' }, (err) => {
        if (err) logToFile("error write file "+err, socket.id);
        else logToFile(savedDir+'ploidy.txt saved', socket.id);
      });
      
      callback(null, id);
    });
  }
};
