// Modo evidencia: `npm run cy:evidencia`.
// Ejecuta las mismas pruebas más despacio para que los videos de cypress/videos se puedan seguir:
// escribe tecla por tecla y hace una pausa corta después de cada acción.
// Con `npm run cy:run` las pruebas corren a velocidad normal.
// Cypress 16 reemplazó Cypress.env() por Cypress.expose() para valores no sensibles como este.

if (Cypress.expose('evidencia')) {
  const PAUSA_MS = 700;
  const RETRASO_TECLA_MS = 90;

  Cypress.Keyboard.defaults({ keystrokeDelay: RETRASO_TECLA_MS });

  ['visit', 'click', 'type', 'clear', 'select', 'check'].forEach((comando) => {
    Cypress.Commands.overwrite(comando, (original, ...argumentos) => {
      const resultado = original(...argumentos);
      return new Promise((resolver) => {
        setTimeout(() => resolver(resultado), PAUSA_MS);
      });
    });
  });
}
