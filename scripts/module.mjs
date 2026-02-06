/**
 * Bastion Manager Module
 * A standalone bastion management interface for D&D 5e
 * @module bastion-manager
 */

import { BastionOverview } from './bastion-overview.mjs';
import { BastionDetail } from './bastion-detail.mjs';

// Module constants
const MODULE_ID = 'bastion-manager';

/**
 * Initialize the module
 */
Hooks.once('init', () => {
  console.log(`${MODULE_ID} | Initializing Bastion Manager`);
  
  // Register module settings
  game.settings.register(MODULE_ID, 'bastionData', {
    name: 'Bastion Data',
    hint: 'Stored bastion configurations (images, names, visibility)',
    scope: 'world',
    config: false,
    type: Object,
    default: {}
  });

  game.settings.register(MODULE_ID, 'buildingOverrides', {
    name: 'Building Overrides',
    hint: 'DM overrides for extra building slots per actor',
    scope: 'world',
    config: false,
    type: Object,
    default: {}
  });

  game.settings.register(MODULE_ID, 'visibilitySettings', {
    name: 'Visibility Settings',
    hint: 'Which players can view which bastions',
    scope: 'world',
    config: false,
    type: Object,
    default: {}
  });

  // Track which bastions to show (GM can hide/show)
  game.settings.register(MODULE_ID, 'enabledBastions', {
    name: 'Enabled Bastions',
    hint: 'Which actor bastions are enabled in the overview',
    scope: 'world',
    config: false,
    type: Object,
    default: {}
  });

  // Configurable setting for columns per row
  game.settings.register(MODULE_ID, 'columnsPerRow', {
    name: 'BASTION_MANAGER.Settings.ColumnsPerRow.Name',
    hint: 'BASTION_MANAGER.Settings.ColumnsPerRow.Hint',
    scope: 'world',
    config: true,
    type: Number,
    default: 2,
    range: {
      min: 1,
      max: 4,
      step: 1
    },
    onChange: () => {
      // Re-render the overview if it's open
      if (game.bastionManager?.overview?.rendered) {
        game.bastionManager.overview.render();
      }
    }
  });

  // Configurable setting for card height
  game.settings.register(MODULE_ID, 'cardHeight', {
    name: 'BASTION_MANAGER.Settings.CardHeight.Name',
    hint: 'BASTION_MANAGER.Settings.CardHeight.Hint',
    scope: 'world',
    config: true,
    type: Number,
    default: 80,
    range: {
      min: 60,
      max: 200,
      step: 10
    },
    onChange: () => {
      // Re-render the overview if it's open
      if (game.bastionManager?.overview?.rendered) {
        game.bastionManager.overview.render();
      }
    }
  });
});

/**
 * When the game is ready, set up the module
 */
Hooks.once('ready', () => {
  console.log(`${MODULE_ID} | Bastion Manager Ready`);
  
  // Make the app accessible globally
  game.bastionManager = {
    overview: null,
    detailApps: new Map(),
    
    /**
     * Open the main bastion overview
     */
    openOverview: () => {
      if (game.bastionManager.overview?.rendered) {
        game.bastionManager.overview.bringToFront();
      } else {
        game.bastionManager.overview = new BastionOverview();
        game.bastionManager.overview.render({ force: true });
      }
    },
    
    /**
     * Open the detail view for a specific actor's bastion
     * @param {string} actorId 
     */
    openDetail: (actorId) => {
      const existing = game.bastionManager.detailApps.get(actorId);
      if (existing?.rendered) {
        existing.bringToFront();
      } else {
        const app = new BastionDetail({ actorId });
        game.bastionManager.detailApps.set(actorId, app);
        app.render({ force: true });
      }
    },
    
    /**
     * Get bastion data for an actor
     * @param {string} actorId 
     * @returns {Object}
     */
    getBastionData: (actorId) => {
      const data = game.settings.get(MODULE_ID, 'bastionData') || {};
      return data[actorId] || {};
    },
    
    /**
     * Set bastion data for an actor
     * @param {string} actorId 
     * @param {Object} newData 
     */
    setBastionData: async (actorId, newData) => {
      const data = foundry.utils.deepClone(game.settings.get(MODULE_ID, 'bastionData') || {});
      data[actorId] = foundry.utils.mergeObject(data[actorId] || {}, newData);
      await game.settings.set(MODULE_ID, 'bastionData', data);
    },
    
    /**
     * Get building overrides for an actor
     * @param {string} actorId 
     * @returns {Object}
     */
    getBuildingOverrides: (actorId) => {
      const overrides = game.settings.get(MODULE_ID, 'buildingOverrides') || {};
      return overrides[actorId] || { basic: 0, special: 0 };
    },
    
    /**
     * Set building overrides for an actor (GM only)
     * @param {string} actorId 
     * @param {Object} overrides 
     */
    setBuildingOverrides: async (actorId, overrides) => {
      if (!game.user.isGM) return;
      const data = foundry.utils.deepClone(game.settings.get(MODULE_ID, 'buildingOverrides') || {});
      data[actorId] = overrides;
      await game.settings.set(MODULE_ID, 'buildingOverrides', data);
    },
    
    /**
     * Check if a user can view an actor's bastion
     * @param {string} actorId 
     * @param {string} userId 
     * @returns {boolean}
     */
    canViewBastion: (actorId, userId = game.user.id) => {
      // GMs can always view
      if (game.users.get(userId)?.isGM) return true;
      
      // Check if user owns the actor
      const actor = game.actors.get(actorId);
      if (actor?.isOwner) return true;
      
      // Check visibility settings
      const visibility = game.settings.get(MODULE_ID, 'visibilitySettings') || {};
      const actorVisibility = visibility[actorId] || {};
      
      // Check if shared with everyone or specific user
      return actorVisibility.public || actorVisibility.users?.includes(userId);
    },
    
    /**
     * Set visibility for a bastion
     * @param {string} actorId 
     * @param {Object} settings 
     */
    setVisibility: async (actorId, settings) => {
      const actor = game.actors.get(actorId);
      if (!actor?.isOwner && !game.user.isGM) return;
      
      const data = foundry.utils.deepClone(game.settings.get(MODULE_ID, 'visibilitySettings') || {});
      data[actorId] = settings;
      await game.settings.set(MODULE_ID, 'visibilitySettings', data);
    },
    
    /**
     * Check if a bastion is enabled in the overview
     * @param {string} actorId 
     * @returns {boolean}
     */
    isBastionEnabled: (actorId) => {
      const enabled = game.settings.get(MODULE_ID, 'enabledBastions') || {};
      // By default, all bastions are enabled unless explicitly disabled
      return enabled[actorId] !== false;
    },
    
    /**
     * Set whether a bastion is enabled
     * @param {string} actorId 
     * @param {boolean} isEnabled 
     */
    setBastionEnabled: async (actorId, isEnabled) => {
      if (!game.user.isGM) return;
      
      const data = foundry.utils.deepClone(game.settings.get(MODULE_ID, 'enabledBastions') || {});
      data[actorId] = isEnabled;
      await game.settings.set(MODULE_ID, 'enabledBastions', data);
      
      // Re-render the overview if open
      if (game.bastionManager?.overview?.rendered) {
        game.bastionManager.overview.render();
      }
    },
    
    MODULE_ID
  };
});

/**
 * Add bastion manager button to the Notes scene controls
 */
Hooks.on('getSceneControlButtons', (controls) => {
  // Only show if dnd5e system is active
  if (game.system.id !== 'dnd5e') return;

  // In V13, controls is an object keyed by control name
  if (!controls.notes?.tools) return;
  
  // Add bastion manager button to notes tools
  controls.notes.tools.bastionManager = {
    name: 'bastionManager',
    title: 'BASTION_MANAGER.SceneControl.Title',
    icon: 'fa-solid fa-chess-rook',
    button: true,
    onChange: () => game.bastionManager.openOverview()
  };
});

// Export for use in other modules
export { BastionOverview, BastionDetail, MODULE_ID };
