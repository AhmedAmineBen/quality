const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const app = express();
// Utilisation du dossier temporaire pour Vercel
const upload = multer({ dest: '/tmp/' });

// Configuration EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middlewares
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

// Traitement des fichiers
const processUpload = (file, callback) => {
  try {
    if (path.extname(file.originalname).toLowerCase() === '.xlsx') {
      const workbook = XLSX.readFile(file.path);
      const sheetName = workbook.SheetNames[0];
      callback(XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]));
    } else {
      const results = [];
      fs.createReadStream(file.path)
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', () => callback(results));
    }
  } catch (error) {
    console.error('Erreur de traitement:', error);
    callback([]);
  }
};

// Correction du calcul de l'indice de Gini
const calculateGini = (data) => {
  const numberOfItems = data.length;
  if (numberOfItems === 0) return 0;
  
  const referencePercentage = 100 / numberOfItems;
  const sumProducts = data.reduce((acc, item) => 
    acc + (item.cumulativePercentage * referencePercentage), 0);
  
  return (sumProducts - 5000) / 5000;
};

// Traitement des données (version corrigée)
function processData(data) {
  if (data.length === 0) return [];

  // Récupération dynamique des noms des colonnes
  const headers = Object.keys(data[0]);
  if (headers.length < 2) return [];
  const problemHeader = headers[0];
  const frequencyHeader = headers[1];

  const frequencyMap = data.reduce((acc, item) => {
    const key = item[problemHeader]?.toString().trim();
    const value = parseFloat(item[frequencyHeader]);

    if (key && !isNaN(value)) {
      acc[key] = (acc[key] || 0) + value;
    }
    return acc;
  }, {});

  const sortedData = Object.entries(frequencyMap)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value }));

  const total = sortedData.reduce((sum, item) => sum + item.value, 0);
  let cumulative = 0;

  return sortedData.map(item => {
    cumulative += item.value;
    return {
      name: item.name,
      value: item.value,
      percentage: Number(((item.value / total) * 100).toFixed(2)),
      cumulativePercentage: Number(((cumulative / total) * 100).toFixed(2))
    };
  });
}

// Classification Gini
function classifyGini(giniIndex) {
  if (giniIndex >= 0.9) {
    return { 
      recommendation: 'Priorité absolue', 
      classification: '80% A, 10% B, 10% C',
      aMax: 80,
      bMax: 90
    };
  }
  if (giniIndex >= 0.85) {
    return { 
      recommendation: 'Suivi rapproché', 
      classification: '70% A, 15% B, 15% C',
      aMax: 70,
      bMax: 85
    };
  }
  if (giniIndex >= 0.75) {
    return { 
      recommendation: 'Contrôle régulier', 
      classification: '60% A, 20% B, 20% C',
      aMax: 60,
      bMax: 80
    };
  }
  if (giniIndex >= 0.65) {
    return { 
      recommendation: 'Contrôle périodique', 
      classification: '50% A, 30% B, 20% C',
      aMax: 50,
      bMax: 80
    };
  }
  if (giniIndex >= 0.6) {
    return { 
      recommendation: 'Pertinence limitée', 
      classification: '50% A, 25% B, 25% C',
      aMax: 50,
      bMax: 75
    };
  }
  return { 
    recommendation: 'Analyse non pertinente : données trop homogènes', 
    classification: 'Données trop homogènes',
    aMax: null,
    bMax: null
  };
}

// Routes
// La route "/" renvoie à menu.ejs
app.get('/', (req, res) => res.render('menu'));

// Route pour afficher landing.ejs (accessible depuis le bouton de menu)
app.get('/landing', (req, res) => res.render('landing'));

// Route pour afficher la page d'upload
app.get('/upload', (req, res) => res.render('index'));

// Route pour afficher la page charts.ejs
app.get('/charts', (req, res) => res.render('charts'));

app.post('/upload', upload.single('datafile'), (req, res) => {
  const hasFile = !!req.file;
  const hasManual = req.body.problem?.length > 0 && req.body.frequency?.length > 0;

  if (hasFile && hasManual) {
    return res.status(400).send('Utilisez soit le fichier soit la saisie manuelle !');
  }

  if (!hasFile && !hasManual) {
    return res.status(400).send('Aucune donnée fournie !');
  }

  const analysisType = req.body.analysisType || 'gini';

  const processAndRespond = (rawData) => {
    try {
      const processedData = processData(rawData);
      let giniIndex, giniClassification;
      
      if (analysisType === 'abc') {
        const classA = parseFloat(req.body.classA);
        const classB = parseFloat(req.body.classB);
        const classC = parseFloat(req.body.classC);
        
        if (Math.abs(classA + classB + classC - 100) > 0.1) {
          return res.status(400).send('Erreur de répartition : la somme des classes doit être exactement 100%');
        }
        
        giniIndex = null;
        giniClassification = {
          recommendation: 'Analyse ABC personnalisée',
          classification: `${classA.toFixed(1)}% A, ${classB.toFixed(1)}% B, ${classC.toFixed(1)}% C`,
          aMax: classA,
          bMax: classA + classB
        };
      } else {
        giniIndex = calculateGini(processedData);
        giniClassification = classifyGini(giniIndex);
      }

      const categorizedData = processedData.map(item => ({
        ...item,
        category: (giniClassification.aMax === null) ? 'N/A' :
          item.cumulativePercentage <= giniClassification.aMax ? 'A' :
          item.cumulativePercentage <= giniClassification.bMax ? 'B' : 'C'
      }));

      if (analysisType === 'abc') {
        res.render('result-personnalise', { 
          data: categorizedData, 
          giniIndex,
          giniClassification
        });
      } else {
        res.render('result', { 
          data: categorizedData, 
          giniIndex,
          giniClassification
        });
      }
    } catch (error) {
      console.error('Erreur:', error);
      res.status(500).send('Erreur de traitement');
    }
  };

  if (hasFile) {
    processUpload(req.file, (fileData) => {
      fs.unlinkSync(req.file.path);
      processAndRespond(fileData);
    });
  } else {
    const manualData = req.body.problem.map((problem, index) => ({
      [Object.keys(req.body)[0]]: problem.trim(),
      [Object.keys(req.body)[1]]: parseInt(req.body.frequency[index], 10)
    })).filter(item => item[Object.keys(item)[0]] && !isNaN(item[Object.keys(item)[1]]));

    processAndRespond(manualData);
  }
});

// Fonction de traitement des cartes de contrôle
const processControlChart = (file, chartType, callback) => {
  try {
    const workbook = XLSX.readFile(file.path);
    const sheetName = workbook.SheetNames[0];
    let df = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
    
    // Renommage de la première colonne
    const firstKey = Object.keys(df[0])[0];
    df = df.map(row => ({
      Echantillon: row[firstKey],
      ...Object.fromEntries(
        Object.entries(row).filter(([k]) => k !== firstKey)
      )
    }));

    // Détection des colonnes numériques
    const numericCols = Object.keys(df[0]).filter(k => {
      if (k === 'Echantillon') return false;
      const val = df[0][k];
      return !isNaN(parseFloat(val.toString().replace(',', '.')));
    });

    // Conversion et calcul des valeurs
    const processed = df.map(row => {
      const values = numericCols.map(c => {
        const val = row[c].toString().replace(',', '.');
        return parseFloat(val);
      });
      
      return {
        moyennes: values.reduce((a, b) => a + b, 0) / values.length,
        Etendues: Math.max(...values) - Math.min(...values)
      };
    });

    // Calcul des moyennes globales
    const X_double_bar = processed.reduce((a, v) => a + v.moyennes, 0) / processed.length;
    const R_bar = processed.reduce((a, v) => a + v.Etendues, 0) / processed.length;

    // Lecture des coefficients depuis file.csv
    const coeffFile = fs.readFileSync(path.join(__dirname, 'file.csv'), 'utf-8').split('\n');
    const headers = coeffFile[0].split(',').map(h => h.trim());
    const coeffRow = coeffFile.slice(1).find(line => {
      const [nVal] = line.split(',').map(v => v.trim());
      return parseInt(nVal) === numericCols.length;
    });

    if (!coeffRow) throw new Error('Coefficients non trouvés');
    
    const coeffData = coeffRow.split(',').map(v => v.trim());
    const getCoeff = (name) => parseFloat(coeffData[headers.indexOf(name)].replace(',', '.'));
    
    const A2 = getCoeff('A2');
    const D3 = getCoeff('D3');
    const D4 = getCoeff('D4');

    // Calcul des limites
    const limits = {
      X: {
        LCL: X_double_bar - A2 * R_bar,
        CL: X_double_bar,
        UCL: X_double_bar + A2 * R_bar
      },
      R: {
        LCL: D3 * R_bar,
        CL: R_bar,
        UCL: D4 * R_bar
      }
    };

    // Configuration du graphique
    const chartData = {
      labels: df.map((_, i) => i + 1),
      datasets: [
        {
          label: chartType === 'x' ? 'Moyennes' : 'Étendues',
          data: processed.map(r => chartType === 'x' ? r.moyennes : r.Etendues),
          borderColor: '#4f46e5',
          tension: 0.1
        },
        {
          label: 'CL',
          data: Array(df.length).fill(limits[chartType.toUpperCase()].CL),
          borderColor: '#9333ea',
          borderDash: [5, 5]
        },
        {
          label: 'LCL',
          data: Array(df.length).fill(limits[chartType.toUpperCase()].LCL),
          borderColor: '#ef4444',
          borderDash: [5, 5]
        },
        {
          label: 'UCL',
          data: Array(df.length).fill(limits[chartType.toUpperCase()].UCL),
          borderColor: '#22c55e',
          borderDash: [5, 5]
        }
      ]
    };

    callback(null, {
      chartType: chartType.toUpperCase(),
      chartData: chartData,
      limits: limits[chartType.toUpperCase()],
      coefficients: { A2, D3, D4 }
    });
    
  } catch (err) {
    callback(err);
  } finally {
    fs.unlinkSync(file.path);
  }
};

// Routes pour le traitement des cartes de contrôle
app.get('/control-charts', (req, res) => res.render('control-charts'));
app.post('/control-charts', upload.single('datafile'), (req, res) => {
  processControlChart(req.file, req.body.chartType, (err, result) => {
    if (err) return res.status(500).send(err.message);
    res.render('control-results', result);
  });
});

// Export de l'application pour Vercel ou démarrage local
if (process.env.VERCEL) {
  module.exports = app;
} else {
  app.listen(3000, () => console.log('Serveur démarré: http://localhost:3000'));
}
