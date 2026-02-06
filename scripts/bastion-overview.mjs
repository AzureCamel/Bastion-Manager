/**
 * Bastion Overview Application
 * Shows all player bastions as clickable cards
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const MODULE_ID = 'bastion-manager';

/**
 * Main Bastion Overview - shows all player bastions
 * @extends {HandlebarsApplicationMixin(ApplicationV2)}
 */
export class BastionOverview extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    id: 'bastion-overview',
    classes: ['bastion-manager', 'bastion-overview'],
    tag: 'div',
    position: {
      width: 800,
      height: 600
    },
    window: {
      title: 'BASTION_MANAGER.Overview.Title',
      icon: 'fa-solid fa-chess-rook',
      resizable: true,
      minimizable: true
    },
    actions: {
      openBastion: BastionOverview.#onOpenBastion,
      refreshBastions: BastionOverview.#onRefresh,
      openSettings: BastionOverview.#onOpenSettings,
      manageBastions: BastionOverview.#onManageBastions
    }
  };

  /** @override */
  static PARTS = {
    main: {
      template: 'modules/bastion-manager/templates/overview.hbs',
      scrollable: ['.bastion-grid']
    }
  };

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    
    context.isGM = game.user.isGM;
    context.bastions = await this._prepareBastionsContext();
    context.hasBastions = context.bastions.length > 0;
    context.columnsPerRow = game.settings.get(MODULE_ID, 'columnsPerRow') || 2;
    context.cardHeight = game.settings.get(MODULE_ID, 'cardHeight') || 80;
    
    return context;
  }

  /**
   * Check if an actor is claimed by a player (has a non-GM owner)
   * @param {Actor5e} actor 
   * @returns {boolean}
   */
  _isPlayerClaimed(actor) {
    // Check if any non-GM user has ownership of this actor
    const ownership = actor.ownership || {};
    
    for (const [userId, level] of Object.entries(ownership)) {
      // Skip default ownership
      if (userId === 'default') continue;
      
      // Check if this user exists and is not a GM
      const user = game.users.get(userId);
      if (user && !user.isGM && level === CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Prepare the bastions data for rendering
   * @returns {Promise<Array>}
   */
  async _prepareBastionsContext() {
    const bastions = [];
    
    // Get all character actors that are claimed by players (not GM-only) and enabled
    const characters = game.actors.filter(a => {
      // Must be a character
      if (a.type !== 'character') return false;
      
      // Must be claimed by at least one player (non-GM)
      if (!this._isPlayerClaimed(a)) return false;
      
      // Must be enabled (or not explicitly disabled)
      if (!game.bastionManager.isBastionEnabled(a.id)) return false;
      
      return true;
    });
    
    for (const actor of characters) {
      // Check if user can view this bastion
      if (!game.bastionManager.canViewBastion(actor.id)) continue;
      
      // Get custom bastion data
      const bastionData = game.bastionManager.getBastionData(actor.id);
      const visibility = game.settings.get(MODULE_ID, 'visibilitySettings')?.[actor.id] || {};
      
      // Count facilities
      const facilities = actor.itemTypes.facility || [];
      const basicCount = facilities.filter(f => f.system.type.value === 'basic').length;
      const specialCount = facilities.filter(f => f.system.type.value === 'special').length;
      
      // Get building limits with overrides
      const overrides = game.bastionManager.getBuildingOverrides(actor.id);
      const level = actor.system.details?.level || 1;
      const advancement = CONFIG.DND5E.facilities.advancement;
      
      let basicMax = 0, specialMax = 0;
      for (const [type, config] of Object.entries(advancement)) {
        const [, available] = Object.entries(config).reverse().find(([lvl]) => Number(lvl) <= level) || [];
        if (type === 'basic') basicMax = (available || 0) + (overrides.basic || 0);
        else specialMax = (available || 0) + (overrides.special || 0);
      }
      
      // Determine if the current user owns this bastion
      const isOwner = actor.isOwner;
      const canEdit = isOwner || game.user.isGM;
      
      bastions.push({
        actorId: actor.id,
        actorName: actor.name,
        actorImg: actor.img,
        bastionName: bastionData.name || actor.system.bastion?.name || `${actor.name}'s Bastion`,
        bastionImg: bastionData.image || actor.system.bastion?.image || 'icons/svg/tower.svg',
        accentColor: bastionData.accentColor || '#2d2d2d',
        fadeAmount: bastionData.fadeAmount ?? 70,
        disableFade: bastionData.disableFade || false,
        textColor: bastionData.textColor || '#ffffff',
        textOutline: bastionData.textOutline || false,
        isOwner,
        canEdit,
        isPublic: visibility.public || false,
        sharedWith: visibility.users?.length || 0,
        basicCount,
        basicMax,
        specialCount,
        specialMax,
        totalFacilities: facilities.length
      });
    }
    
    return bastions;
  }

  /* -------------------------------------------- */
  /*  Event Handlers                              */
  /* -------------------------------------------- */

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
  }

  /**
   * Handle clicking the settings button
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onOpenSettings(event, target) {
    event.preventDefault();
    event.stopPropagation();
    
    const actorId = target.dataset.actorId;
    if (!actorId) return;
    
    const actor = game.actors.get(actorId);
    if (!actor) return;
    
    const canEdit = actor.isOwner || game.user.isGM;
    if (!canEdit) return;
    
    // Show settings dialog - 'this' is bound to the app instance in AppV2 actions
    await this._showSettingsDialog(actorId);
  }

  /**
   * Show settings dialog for a bastion
   * @param {string} actorId 
   */
  async _showSettingsDialog(actorId) {
    const actor = game.actors.get(actorId);
    if (!actor) return;
    
    const bastionData = game.bastionManager.getBastionData(actorId);
    const visibility = game.settings.get(MODULE_ID, 'visibilitySettings')?.[actorId] || {};
    const overrides = game.bastionManager.getBuildingOverrides(actorId);
    const players = game.users.filter(u => !u.isGM);
    
    const currentColor = bastionData.accentColor || '#2d2d2d';
    const currentFade = bastionData.fadeAmount ?? 70;
    const currentTextColor = bastionData.textColor || '#ffffff';
    const disableFade = bastionData.disableFade || false;
    const textOutline = bastionData.textOutline || false;
    
    const playerCheckboxes = players.map(p => {
      const checked = visibility.users?.includes(p.id) ? 'checked' : '';
      return `<label class="checkbox"><input type="checkbox" name="user-${p.id}" ${checked}> ${p.name}</label>`;
    }).join('');

    const content = `
      <div class="bastion-settings-form">
        <fieldset>
          <legend><i class="fas fa-info-circle"></i> ${game.i18n.localize('BASTION_MANAGER.Dialog.BasicInfo')}</legend>
          
          <div class="form-group">
            <label>${game.i18n.localize('BASTION_MANAGER.Dialog.BastionName')}</label>
            <input type="text" name="bastionName" value="${bastionData.name || ''}" placeholder="${actor.name}'s Bastion">
          </div>
          
          <div class="form-group">
            <label>${game.i18n.localize('BASTION_MANAGER.ContextMenu.SetImage')}</label>
            <div class="form-fields">
              <input type="text" name="bastionImage" value="${bastionData.image || ''}" placeholder="icons/svg/tower.svg">
              <button type="button" class="picker-btn btn-file-picker" title="${game.i18n.localize('BASTION_MANAGER.Dialog.BrowseFiles')}"><i class="fas fa-file-import"></i></button>
            </div>
          </div>
        </fieldset>
        
        <fieldset>
          <legend><i class="fas fa-palette"></i> ${game.i18n.localize('BASTION_MANAGER.Dialog.Appearance')}</legend>
          
          <div class="form-group">
            <label>${game.i18n.localize('BASTION_MANAGER.Dialog.AccentColor')}</label>
            <div class="form-fields color-field">
              <input type="color" name="accentColor" value="${currentColor}">
              <input type="text" name="accentColorText" value="${currentColor}" placeholder="#2d2d2d" maxlength="7">
              <button type="button" class="picker-btn btn-reset-color" title="${game.i18n.localize('BASTION_MANAGER.Dialog.ResetColor')}"><i class="fas fa-undo"></i></button>
            </div>
            <p class="hint">${game.i18n.localize('BASTION_MANAGER.Dialog.AccentColorHint')}</p>
          </div>
          
          <div class="form-group">
            <label>${game.i18n.localize('BASTION_MANAGER.Dialog.FadeAmount')}</label>
            <div class="form-fields slider-field">
              <input type="range" name="fadeAmount" min="5" max="100" step="5" value="${currentFade}" ${disableFade ? 'disabled' : ''}>
              <span class="range-value">${currentFade}%</span>
              <button type="button" class="picker-btn btn-reset-fade" title="${game.i18n.localize('BASTION_MANAGER.Dialog.ResetFade')}"><i class="fas fa-undo"></i></button>
            </div>
            <p class="hint">${game.i18n.localize('BASTION_MANAGER.Dialog.FadeAmountHint')}</p>
          </div>
          
          <div class="form-group">
            <label class="checkbox">
              <input type="checkbox" name="disableFade" ${disableFade ? 'checked' : ''}>
              ${game.i18n.localize('BASTION_MANAGER.Dialog.DisableFade')}
            </label>
            <p class="hint">${game.i18n.localize('BASTION_MANAGER.Dialog.DisableFadeHint')}</p>
          </div>
          
          <div class="form-group">
            <label>${game.i18n.localize('BASTION_MANAGER.Dialog.TextColor')}</label>
            <div class="form-fields color-field">
              <input type="color" name="textColor" value="${currentTextColor}">
              <input type="text" name="textColorText" value="${currentTextColor}" placeholder="#ffffff" maxlength="7">
              <button type="button" class="picker-btn btn-reset-text-color" title="${game.i18n.localize('BASTION_MANAGER.Dialog.ResetTextColor')}"><i class="fas fa-undo"></i></button>
            </div>
            <p class="hint">${game.i18n.localize('BASTION_MANAGER.Dialog.TextColorHint')}</p>
          </div>
          
          <div class="form-group">
            <label class="checkbox">
              <input type="checkbox" name="textOutline" ${textOutline ? 'checked' : ''}>
              ${game.i18n.localize('BASTION_MANAGER.Dialog.TextOutline')}
            </label>
            <p class="hint">${game.i18n.localize('BASTION_MANAGER.Dialog.TextOutlineHint')}</p>
          </div>
        </fieldset>
        
        <fieldset>
          <legend><i class="fas fa-eye"></i> ${game.i18n.localize('BASTION_MANAGER.ContextMenu.Visibility')}</legend>
          
          <div class="form-group">
            <label class="checkbox">
              <input type="checkbox" name="public" ${visibility.public ? 'checked' : ''}>
              ${game.i18n.localize('BASTION_MANAGER.Visibility.Public')}
            </label>
            <p class="hint">${game.i18n.localize('BASTION_MANAGER.Visibility.PublicHint')}</p>
          </div>
          
          ${players.length ? `
          <div class="form-group">
            <label>${game.i18n.localize('BASTION_MANAGER.Visibility.ShareWith')}</label>
            <div class="player-checkboxes">${playerCheckboxes}</div>
          </div>
          ` : ''}
        </fieldset>
        
        ${game.user.isGM ? `
        <fieldset>
          <legend><i class="fas fa-tools"></i> ${game.i18n.localize('BASTION_MANAGER.ContextMenu.BuildingOverrides')}</legend>
          <p class="hint" style="margin-top:0">${game.i18n.localize('BASTION_MANAGER.BuildingOverrides.Description')}</p>
          <div class="form-group-inline">
            <div class="form-group">
              <label>${game.i18n.localize('BASTION_MANAGER.BuildingOverrides.ExtraBasic')}</label>
              <input type="number" name="overrideBasic" value="${overrides.basic || 0}" min="0" max="20">
            </div>
            <div class="form-group">
              <label>${game.i18n.localize('BASTION_MANAGER.BuildingOverrides.ExtraSpecial')}</label>
              <input type="number" name="overrideSpecial" value="${overrides.special || 0}" min="0" max="20">
            </div>
          </div>
        </fieldset>
        ` : ''}
      </div>
    `;

    // Store reference for the overview to re-render
    const overview = this;

    const dialog = await foundry.applications.api.DialogV2.prompt({
      window: { 
        title: `${game.i18n.localize('BASTION_MANAGER.ContextMenu.Settings')}: ${actor.name}`,
        icon: 'fa-solid fa-cog'
      },
      position: {
        width: 480
      },
      content,
      ok: {
        label: game.i18n.localize('Save'),
        callback: async (event, button, dialog) => {
          const form = button.form;
          
          // Save bastion data
          const newBastionData = {
            name: form.elements.bastionName?.value?.trim() || null,
            image: form.elements.bastionImage?.value?.trim() || null,
            accentColor: form.elements.accentColor?.value?.trim() || '#2d2d2d',
            fadeAmount: parseInt(form.elements.fadeAmount?.value) || 70,
            disableFade: form.elements.disableFade?.checked || false,
            textColor: form.elements.textColor?.value?.trim() || '#ffffff',
            textOutline: form.elements.textOutline?.checked || false
          };
          await game.bastionManager.setBastionData(actorId, newBastionData);
          
          // Save visibility
          const isPublic = form.elements.public?.checked || false;
          const sharedUsers = players
            .filter(p => form.elements[`user-${p.id}`]?.checked)
            .map(p => p.id);
          await game.bastionManager.setVisibility(actorId, { public: isPublic, users: sharedUsers });
          
          // Save overrides (GM only)
          if (game.user.isGM) {
            const overrideBasic = parseInt(form.elements.overrideBasic?.value) || 0;
            const overrideSpecial = parseInt(form.elements.overrideSpecial?.value) || 0;
            await game.bastionManager.setBuildingOverrides(actorId, { basic: overrideBasic, special: overrideSpecial });
          }
          
          return true;
        }
      },
      rejectClose: false,
      // Render callback to set up event listeners
      render: (event, dialogInstance) => {
        const dialogEl = dialogInstance.element;
        
        // Find the form - it's inside .window-content
        let form = dialogEl?.querySelector('.window-content .bastion-settings-form');
        if (!form) form = dialogEl?.querySelector('.bastion-settings-form');
        if (!form) form = document.querySelector('.bastion-settings-form');
        
        if (!form) {
          // Try with a small delay in case content isn't rendered yet
          setTimeout(() => {
            const delayedForm = document.querySelector('.bastion-settings-form');
            if (delayedForm) {
              this._setupSettingsFormListeners(delayedForm);
            }
          }, 50);
          return;
        }
        
        this._setupSettingsFormListeners(form);
      }
    });

    if (dialog) {
      this.render();
    }
  }
  
  /**
   * Setup event listeners for the settings form
   * @param {HTMLElement} form 
   */
  _setupSettingsFormListeners(form) {
    // File picker button
    const filePickerBtn = form.querySelector('.btn-file-picker');
    filePickerBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const input = form.querySelector('input[name="bastionImage"]');
      if (input) {
        const fp = new FilePicker({
          type: 'image',
          current: input.value || '',
          callback: (path) => { input.value = path; }
        });
        fp.render(true);
      }
    });
    
    // Reset color button
    const resetColorBtn = form.querySelector('.btn-reset-color');
    resetColorBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const colorInput = form.querySelector('input[name="accentColor"]');
      const textInput = form.querySelector('input[name="accentColorText"]');
      if (colorInput) colorInput.value = '#2d2d2d';
      if (textInput) textInput.value = '#2d2d2d';
    });
    
    // Reset fade button
    const resetFadeBtn = form.querySelector('.btn-reset-fade');
    resetFadeBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const fadeInput = form.querySelector('input[name="fadeAmount"]');
      const fadeValue = form.querySelector('.range-value');
      if (fadeInput) fadeInput.value = 70;
      if (fadeValue) fadeValue.textContent = '70%';
    });
    
    // Color sync listeners
    const colorInput = form.querySelector('input[name="accentColor"]');
    const colorText = form.querySelector('input[name="accentColorText"]');
    
    colorInput?.addEventListener('input', (e) => {
      if (colorText) colorText.value = e.target.value;
    });
    
    colorText?.addEventListener('input', (e) => {
      if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value) && colorInput) {
        colorInput.value = e.target.value;
      }
    });
    
    // Fade slider listener
    const fadeInput = form.querySelector('input[name="fadeAmount"]');
    const fadeValue = form.querySelector('.range-value');
    
    fadeInput?.addEventListener('input', (e) => {
      if (fadeValue) fadeValue.textContent = `${e.target.value}%`;
    });
    
    // Disable fade checkbox
    const disableFadeCheckbox = form.querySelector('input[name="disableFade"]');
    disableFadeCheckbox?.addEventListener('change', (e) => {
      if (fadeInput) fadeInput.disabled = e.target.checked;
    });
    
    // Text color sync listeners
    const textColorInput = form.querySelector('input[name="textColor"]');
    const textColorText = form.querySelector('input[name="textColorText"]');
    
    textColorInput?.addEventListener('input', (e) => {
      if (textColorText) textColorText.value = e.target.value;
    });
    
    textColorText?.addEventListener('input', (e) => {
      if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value) && textColorInput) {
        textColorInput.value = e.target.value;
      }
    });
    
    // Reset text color button
    const resetTextColorBtn = form.querySelector('.btn-reset-text-color');
    resetTextColorBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (textColorInput) textColorInput.value = '#ffffff';
      if (textColorText) textColorText.value = '#ffffff';
    });
  }

  /**
   * Handle clicking on a bastion card to open detail view
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onOpenBastion(event, target) {
    const actorId = target.closest('[data-actor-id]')?.dataset.actorId;
    if (!actorId) return;
    
    // Check if user can view this bastion
    if (!game.bastionManager.canViewBastion(actorId)) {
      ui.notifications.warn(game.i18n.localize('BASTION_MANAGER.Warnings.NoPermission'));
      return;
    }
    
    game.bastionManager.openDetail(actorId);
  }

  /**
   * Handle refresh button
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onRefresh(event, target) {
    this.render();
  }

  /**
   * Handle manage bastions button (GM only)
   * Shows dialog to add/remove characters from the overview
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onManageBastions(event, target) {
    if (!game.user.isGM) return;
    
    // Get all player-owned character actors
    const allCharacters = game.actors.filter(a => {
      if (a.type !== 'character') return false;
      // Check if any non-GM user owns this actor
      const ownership = a.ownership || {};
      for (const [userId, level] of Object.entries(ownership)) {
        if (userId === 'default') continue;
        const user = game.users.get(userId);
        if (user && !user.isGM && level === CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER) {
          return true;
        }
      }
      return false;
    });
    
    // Build the list of characters with their enabled state
    const characterItems = allCharacters.map(actor => {
      const enabled = game.bastionManager.isBastionEnabled(actor.id);
      const owner = game.users.find(u => !u.isGM && actor.isOwner);
      return `
        <li class="character-item" data-actor-id="${actor.id}">
          <img src="${actor.img}" alt="${actor.name}">
          <div class="character-info">
            <span class="character-name">${actor.name}</span>
            <span class="character-owner">${owner?.name || 'Unknown'}</span>
          </div>
          <label class="checkbox">
            <input type="checkbox" name="actor-${actor.id}" ${enabled ? 'checked' : ''}>
          </label>
        </li>
      `;
    }).join('');
    
    const content = `
      <div class="bastion-manage-form">
        <p class="hint">${game.i18n.localize('BASTION_MANAGER.Dialog.ManageBastionsHint')}</p>
        <ul class="character-list">
          ${characterItems || `<li class="no-characters">${game.i18n.localize('BASTION_MANAGER.Overview.NoCharacters')}</li>`}
        </ul>
      </div>
    `;
    
    const overview = this;
    
    await foundry.applications.api.DialogV2.prompt({
      window: {
        title: game.i18n.localize('BASTION_MANAGER.Dialog.ManageBastions'),
        icon: 'fa-solid fa-users-cog'
      },
      position: { width: 400 },
      content,
      ok: {
        label: game.i18n.localize('Save'),
        callback: async (event, button, dialog) => {
          const form = button.form;
          const enabledBastions = {};
          
          for (const actor of allCharacters) {
            const checkbox = form.elements[`actor-${actor.id}`];
            enabledBastions[actor.id] = checkbox?.checked || false;
          }
          
          await game.settings.set(MODULE_ID, 'enabledBastions', enabledBastions);
          return true;
        }
      },
      rejectClose: false
    });
    
    this.render();
  }
}
