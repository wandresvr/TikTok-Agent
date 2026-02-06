#!/usr/bin/env node
// Script para cerrar procesos de Node.js relacionados con este proyecto

const { execSync } = require('child_process');

try {
  // Buscar procesos de Node.js que estén ejecutando index.js
  const processes = execSync('pgrep -fl "node.*index.js"', { encoding: 'utf-8' })
    .trim()
    .split('\n')
    .filter(line => line.includes('index.js'));

  if (processes.length === 0) {
    console.log('✅ No se encontraron procesos de Node.js ejecutando index.js');
    return;
  }

  console.log('🔍 Procesos encontrados:');
  processes.forEach(proc => {
    const pid = proc.split(' ')[0];
    console.log(`  PID: ${pid} - ${proc.substring(proc.indexOf(' ') + 1)}`);
  });

  // Matar los procesos
  processes.forEach(proc => {
    const pid = proc.split(' ')[0];
    try {
      execSync(`kill -SIGTERM ${pid}`);
      console.log(`✅ Señal SIGTERM enviada al proceso ${pid}`);
    } catch (err) {
      console.error(`❌ Error al matar proceso ${pid}:`, err.message);
    }
  });

  // Esperar un poco y forzar cierre si es necesario
  setTimeout(() => {
    processes.forEach(proc => {
      const pid = proc.split(' ')[0];
      try {
        execSync(`kill -0 ${pid} 2>/dev/null`); // Verificar si aún existe
        console.log(`⚠️  Proceso ${pid} aún existe, forzando cierre...`);
        execSync(`kill -9 ${pid}`);
      } catch (err) {
        // El proceso ya no existe, está bien
      }
    });
    console.log('✅ Limpieza completada');
  }, 2000);

} catch (err) {
  if (err.status === 1) {
    // pgrep retorna 1 cuando no encuentra procesos
    console.log('✅ No se encontraron procesos de Node.js ejecutando index.js');
  } else {
    console.error('❌ Error:', err.message);
  }
}

