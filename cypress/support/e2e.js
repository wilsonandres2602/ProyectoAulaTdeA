// Se carga antes de cada archivo de pruebas.
import './commands';
import './evidencia';

// El fondo animado de las páginas es un GIF externo de varios MB (Giphy). Cypress espera a que
// la página termine de cargar todo antes de seguir, así que ese GIF dejaba el video "cargando"
// al inicio de cada prueba. Es decorativo y externo: se reemplaza por una respuesta vacía.
beforeEach(() => {
  cy.intercept({ method: 'GET', hostname: 'media1.giphy.com' }, { statusCode: 204, body: '' });
});
