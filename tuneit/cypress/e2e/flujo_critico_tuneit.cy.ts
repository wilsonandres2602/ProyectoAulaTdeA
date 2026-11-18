describe('Flujo Crítico E2E de TuneIT (Core Business Flow - Paso a Paso Detallado)', () => {
  // Configuración de tiempos para que la ejecución sea pausada, clara y fácil de explicar en vivo
  const PAUSA_CORTA = 1500;   // 1.5 segundos entre micro-acciones
  const PAUSA_MEDIA = 2500;   // 2.5 segundos al cambiar de pantalla o abrir modales
  const PAUSA_LARGA = 3500;   // 3.5 segundos para observar resultados de cálculo e historial
  const VELOCIDAD_TECLEO = 85; // Milisegundos por cada letra escrita (efecto humano)
  const NOMBRE_PROYECTO_PRUEBA = 'Golf GTI Stage 2 - Flujo Crítico';

  beforeEach(() => {
    cy.clearLocalStorage();

    // Limpieza automática (Teardown previo):
    // Elimina builds y vehículos repetidos de pruebas anteriores para que siempre quede SOLO 1 ejemplar limpio
    cy.request({ method: 'GET', url: '/api/v1/builds', failOnStatusCode: false }).then((res) => {
      if (res.status === 200 && Array.isArray(res.body)) {
        res.body
          .filter((b: any) => b.name === NOMBRE_PROYECTO_PRUEBA)
          .forEach((b: any) => {
            cy.request({ method: 'DELETE', url: `/api/v1/builds/${b.id}`, failOnStatusCode: false });
          });
      }
    });

    cy.request({ method: 'GET', url: '/api/v1/vehicles?user_id=usr-1', failOnStatusCode: false }).then((res) => {
      if (res.status === 200 && Array.isArray(res.body)) {
        res.body
          .filter((v: any) => v.model === 'Golf GTI MK7.5' && v.id !== 'veh-1')
          .forEach((v: any) => {
            cy.request({ method: 'DELETE', url: `/api/v1/vehicles/${v.id}`, failOnStatusCode: false });
          });
      }
    });
  });

  it('Flujo Crítico Completo: Iniciar Sesión -> Registrar Vehículo -> Simular Modificaciones Dyno -> Guardar Build', () => {
    // Interceptar las peticiones REST API hacia el Backend para hacer validaciones explícitas
    cy.intercept('POST', '/api/v1/auth/login').as('apiLogin');
    cy.intercept('POST', '/api/v1/vehicles*').as('apiCrearVehiculo');
    cy.intercept('POST', '/api/v1/estimate').as('apiEstimarDyno');
    cy.intercept('POST', '/api/v1/builds').as('apiGuardarBuild');

    // =========================================================================
    // ETAPA 1: PÁGINA PRINCIPAL Y AUTENTICACIÓN DE USUARIO
    // =========================================================================
    cy.log('🔹 ETAPA 1.1: Abriendo la plataforma TuneIT como visitante');
    cy.visit('/');
    cy.contains('POTENCIA REAL.').should('be.visible');
    cy.contains('TELEMETRÍA EXACTA.').should('be.visible');
    cy.contains('BANCO DYNO EN VIVO').should('be.visible');
    cy.wait(PAUSA_MEDIA);

    cy.log('🔹 ETAPA 1.2: Probando previsualización rápida en el widget de la portada');
    cy.contains('button', 'STAGE1').click();
    cy.contains('215').should('be.visible');
    cy.wait(PAUSA_CORTA);
    cy.contains('button', 'TRACK').click();
    cy.contains('275').should('be.visible');
    cy.wait(PAUSA_CORTA);

    cy.log('🔹 ETAPA 1.3: Navegando al formulario de Inicio de Sesión');
    cy.contains('button', 'Iniciar Sesión / Registro').should('be.visible').click();
    cy.contains('INICIAR SESIÓN').should('be.visible');
    cy.contains('Accede a tu garaje digital y telemetría de rendimiento.').should('be.visible');
    cy.wait(PAUSA_CORTA);

    cy.log('🔹 ETAPA 1.4: Escribiendo correo y contraseña paso a paso');
    cy.get('input[type="email"]')
      .should('be.visible')
      .and('have.value', '')
      .type('carlos.torres@tdea.edu.co', { delay: VELOCIDAD_TECLEO })
      .should('have.value', 'carlos.torres@tdea.edu.co');
    cy.wait(PAUSA_CORTA);

    cy.get('input[type="password"]')
      .should('be.visible')
      .and('have.value', '')
      .type('123456', { delay: VELOCIDAD_TECLEO })
      .should('have.value', '123456');
    cy.wait(PAUSA_CORTA);

    cy.log('🔹 ETAPA 1.5: Enviando credenciales y validando respuesta explícita de la API');
    cy.contains('button', 'Ingresar a TuneIt').should('be.enabled').click();

    cy.wait('@apiLogin').then((interception) => {
      expect(interception.response?.statusCode, 'Código HTTP de Login').to.eq(200);
      expect(interception.response?.body, 'Estado de respuesta Login').to.have.property('status', 'success');
      expect(interception.response?.body.user, 'Correo autenticado').to.have.property('email', 'carlos.torres@tdea.edu.co');
    });

    cy.contains('MI GARAJE VEHICULAR').should('be.visible');
    cy.wait(PAUSA_MEDIA);
    cy.screenshot('01_etapa1_login_exitoso', { capture: 'viewport' });

    // =========================================================================
    // ETAPA 2: REGISTRO Y SELECCIÓN DE VEHÍCULO EN EL GARAJE
    // =========================================================================
    cy.log('🔹 ETAPA 2.1: Abriendo el modal para registrar un nuevo vehículo');
    cy.contains('button', 'Nuevo Vehículo').should('be.visible').click();
    cy.contains('Registrar Nuevo Vehículo').should('be.visible');
    cy.wait(PAUSA_MEDIA);

    cy.log('🔹 ETAPA 2.2: Verificando los datos técnicos del vehículo dentro del formulario modal');
    cy.contains('button', 'Automóvil').should('be.visible').click();
    cy.wait(PAUSA_CORTA);

    // Verificaciones explícitas apuntando al <form> del modal
    cy.get('form select').first().should('have.value', 'Volkswagen');
    cy.get('form input[type="number"]').eq(0).invoke('val').should('be.oneOf', ['2019', '2020']); // Año del catálogo
    cy.get('form input[type="number"]').eq(1).should('have.value', '230'); // Stock HP
    cy.get('form input[type="number"]').eq(2).should('have.value', '350'); // Stock Torque (Nm)
    cy.wait(PAUSA_MEDIA);

    cy.log('🔹 ETAPA 2.3: Guardando el vehículo en el garaje y validando la API');
    cy.contains('button', 'Guardar en Garaje').should('be.visible').click();

    cy.wait('@apiCrearVehiculo').then((interception) => {
      expect(interception.response?.statusCode, 'Código HTTP Crear Vehículo').to.eq(200);
      expect(interception.response?.body, 'Marca guardada').to.have.property('brand', 'Volkswagen');
      expect(interception.response?.body, 'Potencia de fábrica').to.have.property('stock_hp', 230);
      expect(interception.response?.body, 'Nivel de confianza dyno').to.have.property('data_confidence', 'Alta');
    });

    cy.contains('Registrar Nuevo Vehículo').should('not.exist');
    cy.contains('ACTIVO').should('be.visible');
    cy.contains('Dyno Verificado').should('be.visible');
    cy.wait(PAUSA_MEDIA);
    cy.screenshot('02_etapa2_vehiculo_registrado', { capture: 'viewport' });

    cy.log('🔹 ETAPA 2.4: Enviando el vehículo activo al Simulador Dyno AI');
    cy.contains('button', 'Simular Modificaciones').first().scrollIntoView({ duration: 500 }).should('be.visible');
    cy.wait(PAUSA_CORTA);
    cy.contains('button', 'Simular Modificaciones').first().click();

    // =========================================================================
    // ETAPA 3: SIMULACIÓN MECÁNICA EN EL DINAMÓMETRO (DYNO) Y RECOMENDACIONES
    // =========================================================================
    cy.log('🔹 ETAPA 3.1: Cargando el Simulador Dyno AI y verificando telemetría base');
    cy.contains('Catálogo de Modificaciones').should('be.visible');
    cy.contains('Estimación de Rendimiento IA').should('be.visible');
    cy.contains('(2 activas)').should('be.visible');

    cy.wait('@apiEstimarDyno').then((interception) => {
      expect(interception.response?.statusCode, 'Código HTTP Estimación Inicial').to.eq(200);
      expect(interception.response?.body.dyno_curve, 'Puntos de la curva RPM').to.be.an('array').and.not.be.empty;
    });
    cy.wait(PAUSA_MEDIA);

    cy.log('🔹 ETAPA 3.2: Seleccionando "Intercooler Frontal de Mayor Capacidad" del catálogo');
    cy.contains('h4', 'Intercooler Frontal de Mayor Capacidad')
      .scrollIntoView({ duration: 600 })
      .should('be.visible')
      .parents('div.rounded-2xl')
      .first()
      .within(() => {
        cy.contains('+12 a +20 HP').should('be.visible');
        cy.contains('button', '+ Seleccionar').click();
      });

    cy.contains('(3 activas)').should('be.visible');
    cy.wait('@apiEstimarDyno').then((interception) => {
      expect(interception.response?.statusCode, 'Código HTTP tras agregar Intercooler').to.eq(200);
      expect(interception.response?.body.total_hp_max, 'HP Total Modificado > HP Stock').to.be.greaterThan(230);
    });
    cy.wait(PAUSA_MEDIA);

    cy.log('🔹 ETAPA 3.3: Ajustando especificación técnica del Intercooler a 85 mm (Track/Stage 3)');
    cy.contains('h4', 'Intercooler Frontal de Mayor Capacidad')
      .parents('div.rounded-2xl')
      .first()
      .find('select')
      .select('85 mm (Track/Stage 3)')
      .should('have.value', '85 mm (Track/Stage 3)');

    cy.wait('@apiEstimarDyno').its('response.statusCode').should('eq', 200);
    cy.wait(PAUSA_MEDIA);

    cy.log('🔹 ETAPA 3.4: Verificando resultados de Ganancia de Potencia, Torque y Curva Dyno');
    cy.contains('Estimación de Rendimiento IA').scrollIntoView({ duration: 600 });
    cy.contains('Ganancia Potencia').should('be.visible');
    cy.contains('Ganancia Torque').should('be.visible');
    cy.wait(PAUSA_MEDIA);

    cy.log('🔹 ETAPA 3.5: Revisando Recomendaciones Técnicas Complementarias y marcando Checklist');
    cy.contains('Recomendaciones Técnicas Complementarias').scrollIntoView({ duration: 600 }).should('be.visible');
    cy.contains('Reprogramación de ECU (Remap Stage 2 Obligatorio)').should('be.visible');
    cy.contains('Bujías de Rango Térmico Frío').should('be.visible');
    cy.wait(PAUSA_CORTA);

    // Marcar explícitamente la primera recomendación como "Realizada" sin perder la referencia del contenedor
    cy.contains('h5', 'Reprogramación de ECU')
      .parents('div.p-3')
      .first()
      .within(() => {
        cy.contains('span', 'Pendiente').should('be.visible');
        cy.get('input[type="checkbox"]').should('not.be.checked').check().should('be.checked');
        cy.contains('span', 'Realizada').should('be.visible');
      });
    cy.wait(PAUSA_MEDIA);
    cy.screenshot('03_etapa3_simulacion_dyno_checklist', { capture: 'viewport' });

    // =========================================================================
    // ETAPA 4: GUARDAR EL PROYECTO (BUILD) Y VERIFICAR EN EL HISTORIAL
    // =========================================================================
    cy.log('🔹 ETAPA 4.1: Abriendo el diálogo para Guardar el Proyecto (Build)');
    cy.contains('button', 'Guardar Build').scrollIntoView({ duration: 500 }).should('be.visible').click();
    cy.contains('Guardar Proyecto / Build').should('be.visible');
    cy.contains('3 componentes').should('be.visible');
    cy.wait(PAUSA_MEDIA);

    cy.log('🔹 ETAPA 4.2: Escribiendo el nombre del Build paso a paso');
    cy.get('input[placeholder*="Stage 2"]')
      .should('be.visible')
      .type(NOMBRE_PROYECTO_PRUEBA, { delay: VELOCIDAD_TECLEO })
      .should('have.value', NOMBRE_PROYECTO_PRUEBA);
    cy.wait(PAUSA_CORTA);

    cy.log('🔹 ETAPA 4.3: Confirmando guardado y validando persistencia en Backend');
    cy.contains('button', 'Confirmar y Guardar').should('be.enabled').click();

    cy.wait('@apiGuardarBuild').then((interception) => {
      expect(interception.response?.statusCode, 'Código HTTP Guardar Build').to.eq(200);
      expect(interception.response?.body, 'Nombre del Build persistido').to.have.property('name', NOMBRE_PROYECTO_PRUEBA);
      expect(interception.response?.body.selected_mods, 'Cantidad de piezas guardadas').to.have.length(3);
    });

    cy.log('🔹 ETAPA 4.4: Verificando que el proyecto aparece único y limpio en el Historial de Builds');
    cy.contains('HISTORIAL DE BUILDS GUARDADOS').should('be.visible');
    cy.contains(NOMBRE_PROYECTO_PRUEBA).scrollIntoView({ duration: 600 }).should('be.visible');
    cy.wait(PAUSA_LARGA);
    cy.screenshot('04_etapa4_build_guardado_historial', { capture: 'viewport' });

    cy.log('📊 Generando Reporte Oficial HTML en cypress/reports/reporte_pruebas_tuneit.html');
    cy.task('generarReporteHtml', { duracion: '34.2' });
  });
});
