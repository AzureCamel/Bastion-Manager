/**
 * Bastion Detail Application
 * Shows detailed bastion management for a single actor (like Tidy 5e sheets bastion tab)
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const MODULE_ID = 'bastion-manager';

/**
 * Bastion Detail View - manages a single bastion
 * @extends {HandlebarsApplicationMixin(ApplicationV2)}
 */
export class BastionDetail extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.actorId = options.actorId || null;
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    id: 'bastion-detail',
    classes: ['bastion-manager', 'bastion-detail'],
    tag: 'div',
    position: {
      width: 850,
      height: 700
    },
    window: {
      title: 'BASTION_MANAGER.Detail.Title',
      icon: 'fa-solid fa-chess-rook',
      resizable: true,
      minimizable: true
    },
    actions: {
      openFacility: BastionDetail.#onOpenFacility,
      editFacility: BastionDetail.#onEditFacility,
      deleteFacility: BastionDetail.#onDeleteFacility,
      useFacility: BastionDetail.#onUseFacility,
      addFacility: BastionDetail.#onAddFacility,
      deleteOccupant: BastionDetail.#onDeleteOccupant,
      openActor: BastionDetail.#onOpenActor,
      editDescription: BastionDetail.#onEditDescription
    }
  };

  /** @override */
  static PARTS = {
    header: {
      template: 'modules/bastion-manager/templates/detail-header.hbs'
    },
    tabs: {
      template: 'modules/bastion-manager/templates/detail-tabs.hbs'
    },
    facilities: {
      template: 'modules/bastion-manager/templates/detail-facilities.hbs',
      scrollable: ['.facilities-content']
    },
    description: {
      template: 'modules/bastion-manager/templates/detail-description.hbs',
      scrollable: ['.description-content']
    }
  };

  /** @override */
  static TABS = {
    primary: {
      tabs: [
        { id: 'facilities', group: 'primary', icon: 'fa-solid fa-building', label: 'BASTION_MANAGER.Tabs.Facilities' },
        { id: 'description', group: 'primary', icon: 'fa-solid fa-scroll', label: 'BASTION_MANAGER.Tabs.Description' }
      ],
      initial: 'facilities'
    }
  };

  /** @override */
  tabGroups = {
    primary: 'facilities'
  };

  /* -------------------------------------------- */
  /*  Properties                                  */
  /* -------------------------------------------- */

  /**
   * The actor whose bastion is being managed
   * @type {Actor5e|null}
   */
  get actor() {
    return game.actors.get(this.actorId);
  }

  /** @override */
  get title() {
    const actor = this.actor;
    if (!actor) return game.i18n.localize('BASTION_MANAGER.Detail.Title');
    
    const bastionData = game.bastionManager.getBastionData(this.actorId);
    const bastionName = bastionData.name || actor.system.bastion?.name || `${actor.name}'s Bastion`;
    return bastionName;
  }

  /** @override */
  _initializeApplicationOptions(options) {
    options = super._initializeApplicationOptions(options);
    options.uniqueId = `bastion-detail-${options.actorId || 'unknown'}`;
    return options;
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    
    context.actor = this.actor;
    context.actorId = this.actorId;
    context.isGM = game.user.isGM;
    context.isOwner = this.actor?.isOwner || false;
    context.editable = context.isOwner || context.isGM;
    
    if (this.actor) {
      context.bastion = await this._prepareBastionContext();
      context.facilities = await this._prepareFacilitiesContext();
      context.defenders = this._prepareDefendersContext();
      context.hirelings = this._prepareHirelingsContext();
    }

    // Prepare tabs
    context.tabs = this._prepareTabs('primary');

    return context;
  }

  /** @override */
  _preparePartContext(partId, context, options) {
    context.partId = `${this.id}-${partId}`;
    context.tab = context.tabs?.[partId];
    return context;
  }

  /**
   * Prepare the bastion header data
   * @returns {Promise<Object>}
   */
  async _prepareBastionContext() {
    const actor = this.actor;
    if (!actor) return {};

    const bastionData = game.bastionManager.getBastionData(this.actorId);
    const systemBastion = actor.system.bastion || {};
    
    const enrichedDescription = await TextEditor.enrichHTML(systemBastion.description || '', {
      secrets: actor.isOwner,
      relativeTo: actor,
      rollData: actor.getRollData()
    });

    return {
      name: bastionData.name || systemBastion.name || `${actor.name}'s Bastion`,
      image: bastionData.image || 'icons/svg/tower.svg',
      description: enrichedDescription,
      rawDescription: systemBastion.description || ''
    };
  }

  /**
   * Prepare the facilities context
   * @returns {Promise<Object>}
   */
  async _prepareFacilitiesContext() {
    const actor = this.actor;
    if (!actor) return { basic: { chosen: [], available: [] }, special: { chosen: [], available: [] } };

    const facilities = { basic: { chosen: [] }, special: { chosen: [] } };
    const facilityItems = actor.itemTypes.facility || [];

    for (const facility of facilityItems) {
      const ctx = await this._prepareFacilityContext(facility);
      if (ctx.isSpecial) {
        facilities.special.chosen.push(ctx);
      } else {
        facilities.basic.chosen.push(ctx);
      }
    }

    // Calculate available slots based on character level + overrides
    const level = actor.system.details?.level || 1;
    const advancement = CONFIG.DND5E.facilities.advancement;
    const overrides = game.bastionManager.getBuildingOverrides(this.actorId);

    for (const [type, config] of Object.entries(advancement)) {
      const [, baseAvailable] = Object.entries(config).reverse().find(([lvl]) => Number(lvl) <= level) || [];
      const override = type === 'basic' ? (overrides.basic || 0) : (overrides.special || 0);
      const totalAvailable = (baseAvailable || 0) + override;
      
      const current = facilities[type].chosen.filter(f => (type === 'basic') || !f.free).length;
      facilities[type].value = current;
      facilities[type].max = totalAvailable;
      facilities[type].override = override;
      
      const remaining = Math.max(0, totalAvailable - current);
      facilities[type].available = Array.from({ length: remaining }, () => ({
        label: `DND5E.FACILITY.AvailableFacility.${type}.free`
      }));
    }

    // Basic facilities always have at least one "build" slot
    if (!facilities.basic.available.length) {
      facilities.basic.available.push({ label: 'DND5E.FACILITY.AvailableFacility.basic.build' });
    }

    return facilities;
  }

  /**
   * Prepare context for a single facility
   * @param {Item5e} facility
   * @returns {Promise<Object>}
   */
  async _prepareFacilityContext(facility) {
    const data = facility.system;
    const isSpecial = data.type.value === 'special';
    
    // Prepare progress data
    const progress = {
      value: data.progress.value || 0,
      max: data.progress.max,
      pct: data.progress.max ? Math.round((data.progress.value / data.progress.max) * 100) : 0,
      order: data.progress.order
    };

    // Get order icon and label
    let executingIcon = null;
    let executingLabel = null;
    if (progress.order && CONFIG.DND5E.facilities.orders[progress.order]) {
      executingIcon = CONFIG.DND5E.facilities.orders[progress.order].icon;
      executingLabel = CONFIG.DND5E.facilities.orders[progress.order].label;
    }

    // Prepare occupants
    const defenders = await this._prepareOccupants(data.defenders);
    const hirelings = await this._prepareOccupants(data.hirelings);
    const creatures = await this._prepareOccupants(data.trade?.creatures);

    // Prepare crafting info
    let craft = null;
    if (data.craft?.item) {
      const item = await fromUuid(data.craft.item);
      if (item) {
        craft = {
          uuid: data.craft.item,
          name: item.name,
          img: item.img
        };
      }
    }

    // Build subtitle
    const sizeLabel = CONFIG.DND5E.facilities.sizes[data.size]?.label || data.size;
    const typeLabel = data.type.label || CONFIG.DND5E.facilities.types[data.type.value]?.label || '';
    const subtitle = `${game.i18n.localize(typeLabel)} · ${game.i18n.localize(sizeLabel)}`;

    return {
      id: facility.id,
      uuid: facility.uuid,
      facility,
      name: facility.name,
      img: facility.img,
      subtitle,
      isSpecial,
      disabled: data.disabled,
      building: data.building,
      free: data.free,
      progress,
      executing: executingIcon,
      executingLabel: executingLabel ? game.i18n.localize(executingLabel) : null,
      defenders,
      hirelings,
      creatures,
      craft,
      hasOccupants: defenders.length > 0 || hirelings.length > 0 || creatures.length > 0
    };
  }

  /**
   * Prepare occupants array
   * @param {Object} occupantData
   * @returns {Promise<Array>}
   */
  async _prepareOccupants(occupantData) {
    if (!occupantData?.value?.length && !occupantData?.max) return [];
    
    const occupants = [];
    const max = occupantData.max || 0;
    const uuids = occupantData.value || [];

    for (let i = 0; i < max; i++) {
      const uuid = uuids[i];
      if (uuid) {
        const actor = await fromUuid(uuid);
        occupants.push({
          index: i,
          uuid,
          actor: actor ? {
            name: actor.name,
            img: actor.img,
            uuid: actor.uuid
          } : null,
          empty: !actor
        });
      } else {
        occupants.push({
          index: i,
          uuid: null,
          actor: null,
          empty: true
        });
      }
    }

    return occupants;
  }

  /**
   * Prepare defenders roster context
   * @returns {Array}
   */
  _prepareDefendersContext() {
    const defenders = [];
    const facilities = this.actor?.itemTypes.facility || [];

    for (const facility of facilities) {
      const defenderData = facility.system.defenders;
      if (!defenderData?.value?.length) continue;

      for (let i = 0; i < defenderData.value.length; i++) {
        const uuid = defenderData.value[i];
        defenders.push({
          uuid,
          index: i,
          facilityId: facility.id,
          facilityName: facility.name
        });
      }
    }

    return defenders;
  }

  /**
   * Prepare hirelings roster context
   * @returns {Array}
   */
  _prepareHirelingsContext() {
    const hirelings = [];
    const facilities = this.actor?.itemTypes.facility || [];

    for (const facility of facilities) {
      const hirelingData = facility.system.hirelings;
      if (!hirelingData?.value?.length) continue;

      for (let i = 0; i < hirelingData.value.length; i++) {
        const uuid = hirelingData.value[i];
        hirelings.push({
          uuid,
          index: i,
          facilityId: facility.id,
          facilityName: facility.name
        });
      }
    }

    return hirelings;
  }

  /* -------------------------------------------- */
  /*  Event Handlers                              */
  /* -------------------------------------------- */

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    this._setupDragDrop();
    this._setupTabListeners();
  }

  /**
   * Set up tab click listeners
   */
  _setupTabListeners() {
    const tabButtons = this.element.querySelectorAll('.bastion-tabs .tab-btn');
    for (const btn of tabButtons) {
      btn.addEventListener('click', (event) => {
        const tab = btn.dataset.tab;
        const group = btn.dataset.group;
        if (tab && group) {
          // Update button states
          this.element.querySelectorAll(`.bastion-tabs .tab-btn[data-group="${group}"]`).forEach(b => {
            b.classList.toggle('active', b.dataset.tab === tab);
          });
          // Update content visibility
          this.element.querySelectorAll(`.tab-content[data-group="${group}"]`).forEach(content => {
            content.classList.toggle('active', content.dataset.tab === tab);
          });
          // Update internal state
          this.tabGroups[group] = tab;
        }
      });
    }
  }

  /**
   * Set up drag and drop handlers
   */
  _setupDragDrop() {
    // Drop zones for occupants (actors)
    const occupantSlots = this.element.querySelectorAll('.occupant-slot.empty');
    for (const zone of occupantSlots) {
      zone.addEventListener('dragover', this._onDragOver.bind(this));
      zone.addEventListener('dragleave', this._onDragLeave.bind(this));
      zone.addEventListener('drop', this._onDropActor.bind(this));
    }
    
    // Drop zones for facilities (items)
    const facilitySlots = this.element.querySelectorAll('.facility-item.empty[data-facility-type]');
    for (const zone of facilitySlots) {
      zone.addEventListener('dragover', this._onDragOver.bind(this));
      zone.addEventListener('dragleave', this._onDragLeave.bind(this));
      zone.addEventListener('drop', this._onDropFacility.bind(this));
    }
  }

  _onDragOver(event) {
    event.preventDefault();
    event.currentTarget.classList.add('drag-over');
  }

  _onDragLeave(event) {
    event.currentTarget.classList.remove('drag-over');
  }

  /**
   * Handle dropping an actor onto an occupant slot
   */
  async _onDropActor(event) {
    event.preventDefault();
    event.currentTarget.classList.remove('drag-over');

    const data = TextEditor.getDragEventData(event);
    if (!data || data.type !== 'Actor') return;

    const target = event.currentTarget;
    const facilityId = target.closest('[data-facility-id]')?.dataset.facilityId;
    const prop = target.dataset.prop;

    if (!facilityId || !prop) return;

    const facility = this.actor?.items.get(facilityId);
    if (!facility) return;

    const { max, value } = foundry.utils.getProperty(facility, prop) || {};
    if ((value?.length || 0) >= (max || 0)) {
      ui.notifications.warn(game.i18n.localize('BASTION_MANAGER.Warnings.SlotFull'));
      return;
    }

    const newValue = [...(value || []), data.uuid];
    await facility.update({ [`${prop}.value`]: newValue });
    this.render();
  }

  /**
   * Handle dropping a facility item onto an empty facility slot
   */
  async _onDropFacility(event) {
    event.preventDefault();
    event.currentTarget.classList.remove('drag-over');

    if (!this.actor?.isOwner && !game.user.isGM) return;

    const data = TextEditor.getDragEventData(event);
    if (!data || data.type !== 'Item') return;

    const target = event.currentTarget;
    const facilityType = target.dataset.facilityType;
    if (!facilityType) return;

    // Get the dropped item
    const item = await fromUuid(data.uuid);
    if (!item) {
      ui.notifications.error(game.i18n.localize('BASTION_MANAGER.Warnings.ItemNotFound'));
      return;
    }

    // Verify it's a facility
    if (item.type !== 'facility') {
      ui.notifications.warn(game.i18n.localize('BASTION_MANAGER.Warnings.NotAFacility'));
      return;
    }

    // Verify the facility type matches the slot
    const itemFacilityType = item.system?.type?.value;
    if (itemFacilityType !== facilityType) {
      ui.notifications.warn(game.i18n.format('BASTION_MANAGER.Warnings.WrongFacilityType', {
        expected: game.i18n.localize(`DND5E.FACILITY.Types.${facilityType.capitalize()}.Label.one`),
        received: game.i18n.localize(`DND5E.FACILITY.Types.${itemFacilityType?.capitalize() || 'unknown'}.Label.one`)
      }));
      return;
    }

    // Check level requirements
    const actorLevel = this.actor.system.details?.level || 0;
    const facilityLevel = item.system?.level || 0;
    if (facilityLevel > actorLevel) {
      ui.notifications.warn(game.i18n.format('BASTION_MANAGER.Warnings.LevelTooLow', {
        required: facilityLevel,
        current: actorLevel
      }));
      return;
    }

    // Create the facility on the actor
    await this.actor.createEmbeddedDocuments('Item', [item.toObject()]);
    ui.notifications.info(game.i18n.format('BASTION_MANAGER.Notifications.FacilityAdded', { name: item.name }));
    this.render();
  }

  /**
   * Handle opening a facility item sheet
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onOpenFacility(event, target) {
    const facilityId = target.closest('[data-facility-id]')?.dataset.facilityId;
    if (!facilityId) return;
    
    const facility = this.actor?.items.get(facilityId);
    facility?.sheet?.render(true);
  }

  /**
   * Handle editing a facility (opens sheet in edit mode)
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onEditFacility(event, target) {
    event.stopPropagation();
    const facilityId = target.closest('[data-facility-id]')?.dataset.facilityId;
    if (!facilityId) return;
    
    const facility = this.actor?.items.get(facilityId);
    if (!facility) return;
    
    // Open the sheet - let it determine editability based on user permissions
    facility.sheet?.render(true);
  }

  /**
   * Handle deleting a facility
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onDeleteFacility(event, target) {
    event.stopPropagation();
    const facilityId = target.closest('[data-facility-id]')?.dataset.facilityId;
    if (!facilityId) return;
    
    const facility = this.actor?.items.get(facilityId);
    if (!facility) return;
    
    // Confirm deletion
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { 
        title: game.i18n.localize('BASTION_MANAGER.Dialog.DeleteFacility'),
        icon: 'fa-solid fa-trash'
      },
      content: `<p>${game.i18n.format('BASTION_MANAGER.Dialog.DeleteFacilityConfirm', { name: facility.name })}</p>`,
      yes: {
        label: game.i18n.localize('Delete'),
        icon: 'fa-solid fa-trash'
      },
      no: {
        label: game.i18n.localize('Cancel')
      },
      rejectClose: false
    });
    
    if (confirmed) {
      await facility.delete();
      ui.notifications.info(game.i18n.format('BASTION_MANAGER.Notifications.FacilityDeleted', { name: facility.name }));
      this.render();
    }
  }

  /**
   * Handle using a facility (triggering its activities)
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onUseFacility(event, target) {
    const facilityId = target.closest('[data-facility-id]')?.dataset.facilityId;
    if (!facilityId) return;
    
    const facility = this.actor?.items.get(facilityId);
    if (!facility || facility.system.disabled) return;
    
    facility.use({ legacy: false, chooseActivity: true, event });
  }

  /**
   * Handle adding a new facility
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onAddFacility(event, target) {
    const facilityType = target.dataset.facilityType || 'basic';
    if (!this.actor?.isOwner && !game.user.isGM) return;

    const otherType = facilityType === 'basic' ? 'special' : 'basic';

    const result = await dnd5e.applications.CompendiumBrowser.selectOne({
      filters: {
        locked: {
          types: new Set(['facility']),
          additional: {
            type: { [facilityType]: 1, [otherType]: -1 },
            level: { max: this.actor.system.details.level }
          }
        }
      }
    });

    if (result) {
      const item = await fromUuid(result);
      if (item) {
        await this.actor.createEmbeddedDocuments('Item', [item.toObject()]);
        this.render();
      }
    }
  }

  /**
   * Handle deleting an occupant from a facility
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onDeleteOccupant(event, target) {
    event.stopPropagation();
    
    const facilityId = target.closest('[data-facility-id]')?.dataset.facilityId;
    const prop = target.closest('[data-prop]')?.dataset.prop;
    const index = parseInt(target.closest('[data-index]')?.dataset.index);
    
    if (!facilityId || !prop || isNaN(index)) return;
    
    const facility = this.actor?.items.get(facilityId);
    if (!facility) return;

    const currentValue = foundry.utils.getProperty(facility, `${prop}.value`) || [];
    const newValue = currentValue.filter((_, i) => i !== index);
    
    await facility.update({ [`${prop}.value`]: newValue });
    this.render();
  }

  /**
   * Handle opening the actor sheet
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onOpenActor(event, target) {
    this.actor?.sheet?.render(true);
  }

  /**
   * Handle editing the bastion description
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onEditDescription(event, target) {
    if (!this.actor?.isOwner && !game.user.isGM) return;

    const currentDesc = this.actor.system.bastion?.description || '';
    
    const content = `
      <form>
        <div class="form-group stacked">
          <label>${game.i18n.localize('DND5E.FACILITY.Description')}</label>
          <textarea name="description" rows="8" style="width: 100%;">${currentDesc}</textarea>
        </div>
      </form>
    `;

    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize('BASTION_MANAGER.Detail.EditDescription') },
      content,
      ok: {
        label: game.i18n.localize('Save'),
        callback: (event, button, dialog) => button.form.elements.description.value
      },
      rejectClose: false
    });

    if (result !== null && result !== undefined) {
      await this.actor.update({ 'system.bastion.description': result });
      this.render();
    }
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    // Clean up from the map
    game.bastionManager?.detailApps?.delete(this.actorId);
  }
}
