/// <reference types="cypress" />

// Comando personalizado para iniciar sesión rápidamente como usuario Demo / Admin
Cypress.Commands.add('loginAsDemo', () => {
  const demoUser = {
    id: 'usr-1',
    name: 'Carlos Torres',
    email: 'carlos.torres@tdea.edu.co',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=300&q=80',
    role: 'admin',
  };
  window.localStorage.setItem('tuneit_user', JSON.stringify(demoUser));
});

declare global {
  namespace Cypress {
    interface Chainable {
      loginAsDemo(): Chainable<void>;
    }
  }
}

export {};

