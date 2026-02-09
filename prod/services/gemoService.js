const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');
const { logToFile } = require('../utils/logger');

const progPath = '/opt/www/gemo.southgreen.fr/prod/python/';
const workingPath = '/opt/www/wsp1453.southgreen.fr/prod/tmp/gemo_run/';

module.exports = {
  attachHandlers(socket, analysisDir) {
    const realAnalysisDir = analysisDir || '/tmp/fallback/';
    
    socket.on('run', (tsv, callback) => {
      logToFile("run tsv", socket.id);
      
      fs.writeFile(realAnalysisDir + 'musa-acuminata.tsv', tsv, {encoding:'utf8', flag : 'w+' }, function (err) {
        if (err) return logToFile("error write file "+err, socket.id);
        
        logToFile("musa-acuminata.tsv uploaded to : "+realAnalysisDir, socket.id);
        
        try {
          process.chdir(realAnalysisDir);
          logToFile(`New directory: ${process.cwd()}`, socket.id);
        } catch (err) {
          logToFile(`chdir: ${err}`, socket.id);
        }
        
        exec(`python3 ${progPath}convert_band_data_socket.py`, (error, stdout, stderr) => {
          logToFile(`python ${progPath}convert_band_data_socket.py`, socket.id);
          if (error) logToFile(`exec error: ${error}`, socket.id);
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
      
      fs.mkdirSync(realAnalysisDir + id);
      
      fs.writeFile(realAnalysisDir + id + '/annot.txt', annot.join("\n"), {encoding:'utf8', flag : 'w+' }, function (err) {
        if (err) return logToFile("error write file "+err, socket.id);
        logToFile(realAnalysisDir + id + '/annot.txt saved', socket.id);
      });
      
      fs.writeFile(realAnalysisDir + id + '/color.txt', color, {encoding:'utf8', flag : 'w+' }, function (err) {
        if (err) return logToFile("error write file "+err, socket.id);
        logToFile(realAnalysisDir + id + '/color.txt saved', socket.id);
      });
      
      exec(`perl ${progPath}gemo2gff.pl ${ploidy} ${id}/annot.txt ${id}/color.txt ${id}/`, (error, stdout, stderr) => {
        logToFile(`${progPath}gemo2gff.pl ${id}/annot.txt ${id}/color.txt ${id}/`, socket.id);
        if (error) logToFile(`exec error: ${error}`, socket.id);
        logToFile(`stdout: ${stdout}`, socket.id);
        
        let trackURL = "";
        let addStores = "&addStores={";
        let addTracks = "&addTracks=[";
        let index = 0;
        let first = true;
        
        fs.readdir(realAnalysisDir + id, (err, files) => {
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
