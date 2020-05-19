/* global BigInt */
/*
 This file is part of TrelloBot.
 Copyright (c) Snazzah (and contributors) 2016-2020

 This program is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 This program is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

const Command = require('../../structures/Command');
const SubMenu = require('../../structures/SubMenu');
const MultiSelect = require('../../structures/MultiSelect');
const WebhookFilters = require('../../structures/WebhookFilters');
const Trello = require('../../structures/Trello');
const Util = require('../../util');

module.exports = class EditWebhook extends Command {
  get name() { return 'editwebhook'; }

  get _options() { return {
    aliases: ['ewebhook', 'ewh'],
    cooldown: 10,
    permissions: ['embed', 'webhooks', 'trelloRole', 'auth']
  }; }

  async exec(message, { args, _, trello, userData }) {
    const requestedID = parseInt(args[0]);
    if (isNaN(requestedID) || requestedID < 1)
      return message.channel.createMessage(_('webhook_cmd.invalid'));

    const webhook = await this.client.pg.models.get('webhook').findOne({ where: {
      guildID: message.guildID,
      id: requestedID
    }});

    if (!webhook)
      return message.channel.createMessage(_('webhook_cmd.not_found'));

    const locale = webhook.locale ?
      (this.client.locale.locales.get(webhook.locale) || null) : null;

    const _this = this;
    const menu = new SubMenu(this.client, message, {
      header: `**${_('words.locale')}:** ${locale ? locale._.name : '*' + _('locale.unset') + '*'}\n\n` +
        _('webhook_cmd.wywtd'), itemTitle: 'words.subcmd.many', _ });
    return menu.start(message.channel.id, message.author.id, args[1], [
      {
        // Activate/deactivate
        names: ['activate', 'deactivate', 'enable', 'disable'],
        title: _(webhook.active ? 'webhook_cmd.edit_menu.off' : 'webhook_cmd.edit_menu.on'),
        async exec(client) {
          await client.pg.models.get('webhook').update({ active: !webhook.active },
            { where: { id: webhook.id } });
          return message.channel.createMessage(
            _(webhook.active ? 'webhook_cmd.wh_off' : 'webhook_cmd.wh_on'));
        }
      },
      {
        // Edit filters
        names: ['editfilters', 'filter', 'filters'],
        title: _('webhook_cmd.edit_menu.filter'),
        async exec() {
          return _this.editFilters(message, webhook, _);
        }
      },
      {
        // Change locale
        names: ['locale', 'setlocale', 'lang', 'setlant'],
        title: _('webhook_cmd.edit_menu.locale'),
        async exec() {
          return _this.changeLocale(message, args[2], webhook, _);
        }
      },
      {
        // Repair
        names: ['repair', 'fix'],
        title: _('webhook_cmd.edit_menu.repair'),
        async exec() {
          return _this.repairWebhook(message, webhook, trello, userData, _);
        }
      },
      {
        // Delete
        names: ['delete', 'remove'],
        title: _('webhook_cmd.edit_menu.delete') + '\n',
        async exec(client) {
          if (await client.messageAwaiter.confirm(message, _, {
            header: _('webhook_cmd.confirm_delete')
          })) {
            await client.pg.models.get('webhook').destroy({ where: { id: webhook.id } });
            
            // Remove the internal webhook if there are no more webhooks depenging on it
            const trelloMember = await client.pg.models.get('user').findOne({ where: {
              trelloID: webhook.memberID
            }});
            if (trelloMember) {
              const trello = new Trello(client, trelloMember.trelloToken);
              const webhooks = await client.pg.models.get('webhook').findAll({ where: {
                trelloWebhookID: webhook.trelloWebhookID
              }});
              if (!webhooks.length)
                await trello.deleteWebhook(webhook.trelloWebhookID);
            }

            return message.channel.createMessage(_('webhook_cmd.deleted'));
          }
        },
      },
      {
        // Whitelist/Blacklist
        names: ['whitelist', 'wlist', 'blacklist', 'blist'],
        title: _(webhook.whitelist ? 'webhook_cmd.edit_menu.blist' : 'webhook_cmd.edit_menu.wlist'),
        async exec(client) {
          await client.pg.models.get('webhook').update({ whitelist: !webhook.whitelist },
            { where: { id: webhook.id } });
          return message.channel.createMessage(
            _(webhook.active ? 'webhook_cmd.to_blist' : 'webhook_cmd.to_wlist'));
        }
      },
      {
        // Filtered Lists
        names: ['editlists', 'lists', 'list'],
        title: _('webhook_cmd.edit_menu.lists') + ` (${_.toLocaleString(webhook.lists.length)})`,
        async exec() {
          return _this.editFilteredLists(message, webhook, trello, _);
        },
      },
      {
        // Filtered Cards
        names: ['editcards', 'cards', 'card'],
        title: _('webhook_cmd.edit_menu.cards') + ` (${_.toLocaleString(webhook.cards.length)})`,
        async exec() {
          return _this.editFilteredCards(message, webhook, trello, _);
        },
      }
    ]);
  }

  async changeLocale(message, arg, webhook, _) {
    const localeArray = [...this.client.locale.array(), ['unset', null]];
    const localeCommand = this.client.cmds.get('locale');
    const locale = await localeCommand.findLocale(arg, localeArray, message, _);
    if (!locale) return;
    await this.client.pg.models.get('webhook').update({ locale: locale[1] ? locale[0] : null },
      { where: { id: webhook.id } });
    return message.channel.createMessage(
      _(locale[1] ? 'webhook_cmd.locale_set' : 'webhook_cmd.locale_unset', {
        name: locale[1] ? locale[1]._.name : null
      }));
  }

  async editFilteredLists(message, webhook, trello, _) {
    const handle = await trello.handleResponse({
      response: await trello.getLists(webhook.modelID),
      client: this.client, message, _ });
    if (handle.stop) return;
    if (handle.response.status === 404 || handle.response.status === 401)
      return message.channel.createMessage(_('webhook_cmd.no_access'));

    const emojiFallback = Util.emojiFallback({ client: this.client, message });
    const checkEmoji = emojiFallback('632444546684551183', '☑️');
    const uncheckEmoji = emojiFallback('632444550115491910', '⬜');

    const selector = new MultiSelect(this.client, message, {
      path: 'value', checkEmoji, uncheckEmoji,
      header: _('webhook_cmd.choose_lists')
    }, {
      items: handle.body.map(item => ({
        ...item,
        value: webhook.lists.includes(item.id)
      })), _,
      display: (item) => `${
        item.subscribed ? '🔔 ' : ''}${Util.cutoffText(Util.Escape.markdown(item.name), 25)} (${
        _.toLocaleString(item.cards.length)} ${_.numSuffix('words.card', item.cards.length)})`
    });
    const newLists = await selector.start(message.channel.id, message.author.id);
    if (!newLists) return;
    await this.client.pg.models.get('webhook').update(
      { lists: newLists.filter(item => item.value).map(item => item.id) },
      { where: { id: webhook.id } });
    return message.channel.createMessage(_('webhook_cmd.lists_updated'));
  }

  async editFilteredCards(message, webhook, trello, _) {
    const handle = await trello.handleResponse({
      response: await trello.getSlimBoard(webhook.modelID),
      client: this.client, message, _ });
    if (handle.stop) return;
    if (handle.response.status === 404 || handle.response.status === 401)
      return message.channel.createMessage(_('webhook_cmd.no_access'));

    const emojiFallback = Util.emojiFallback({ client: this.client, message });
    const checkEmoji = emojiFallback('632444546684551183', '☑️');
    const uncheckEmoji = emojiFallback('632444550115491910', '⬜');

    const selector = new MultiSelect(this.client, message, {
      path: 'value', checkEmoji, uncheckEmoji,
      header: _('webhook_cmd.choose_cards')
    }, {
      items: handle.body.map(item => ({
        ...item,
        value: webhook.cards.includes(item.id)
      })), _,
      display: card => {
        const list = handle.body.lists.find(list => list.id === card.idList);
        return `${card.closed ? '🗃️ ' : ''}${
          card.subscribed ? '🔔 ' : ''}${Util.cutoffText(Util.Escape.markdown(card.name), 50)}` +
          (list ? ` (${_('words.in_lower')} ${
            Util.cutoffText(Util.Escape.markdown(list.name), 25)})` : '');
      }
    });
    const newCards = await selector.start(message.channel.id, message.author.id);
    if (!newCards) return;
    await this.client.pg.models.get('webhook').update(
      { cards: newCards.filter(item => item.value).map(item => item.id) },
      { where: { id: webhook.id } });
    return message.channel.createMessage(_('webhook_cmd.cards_updated'));
  }

  get filterGroups() {
    return {
      board: [
        'ADD_MEMBER_TO_BOARD',
        'REMOVE_MEMBER_FROM_BOARD',
        'MAKE_ADMIN_OF_BOARD',
        'MAKE_NORMAL_MEMBER_OF_BOARD',
      ],
      boardUpdate: [
        'UPDATE_BOARD_NAME',
        'UPDATE_BOARD_DESC',
        'UPDATE_BOARD_PREFS',
        'UPDATE_BOARD_CLOSED',
      ],
      label: [
        'CREATE_LABEL',
        'DELETE_LABEL',
      ],
      labelUpdate: [
        'UPDATE_LABEL_NAME',
        'UPDATE_LABEL_COLOR',
      ],
      card: [
        'DELETE_CARD',
        'CREATE_CARD',
        'VOTE_ON_CARD',
        'ADD_ATTACHMENT_TO_CARD',
        'DELETE_ATTACHMENT_FROM_CARD',
        'ADD_LABEL_TO_CARD',
        'REMOVE_LABEL_FROM_CARD',
        'ADD_MEMBER_TO_CARD',
        'REMOVE_MEMBER_FROM_CARD',
        'MOVE_CARD_FROM_BOARD',
        'MOVE_CARD_TO_BOARD',
        'COPY_CARD',
      ],
      cardUpdate: [
        'UPDATE_CARD_NAME',
        'UPDATE_CARD_DESC',
        'UPDATE_CARD_LIST',
        'UPDATE_CARD_POS',
        'UPDATE_CARD_CLOSED',
        'UPDATE_CARD_DUE',
      ],
      comment: [
        'COMMENT_CARD',
        'UPDATE_COMMENT',
        'DELETE_COMMENT',
      ],
      checklist: [
        'ADD_CHECKLIST_TO_CARD',
        'REMOVE_CHECKLIST_FROM_CARD',
        'COPY_CHECKLIST',
      ],
      checklistUpdate: [
        'UPDATE_CHECKLIST_NAME',
        'UPDATE_CHECKLIST_POS',
      ],
      checkItem: [
        'UPDATE_CHECK_ITEM_STATE_ON_CARD',
        'CREATE_CHECK_ITEM',
        'DELETE_CHECK_ITEM',
        'CONVERT_TO_CARD_FROM_CHECK_ITEM',
      ],
      checkItemUpdate: [
        'UPDATE_CHECK_ITEM_NAME',
        'UPDATE_CHECK_ITEM_POS',
      ],
      list: [
        'CREATE_LIST',
        'MOVE_LIST_FROM_BOARD',
        'MOVE_LIST_TO_BOARD',
      ],
      listUpdate: [
        'UPDATE_LIST_NAME',
        'UPDATE_LIST_POS',
        'UPDATE_LIST_CLOSED',
      ]
    };
  }

  async editFilters(message, webhook, _) {
    const filters = new WebhookFilters(BigInt(webhook.filters));
    const selectItems = [];
    Util.keyValueForEach(this.filterGroups, (key, value) => {
      // Croup title
      selectItems.push({
        flag: null,
        group: key,
        name: '`━━` **' + _('webhook_filter_group.' + key) + '**',
        value: filters.has(value)
      });
      // Flags
      value.forEach((flag, index) => selectItems.push({
        flag, name: _('webhook_filters.' + flag) + (index === value.length - 1 ? '\n' : ''),
        value: filters.has(flag),
        group: key
      }));
    });

    const emojiFallback = Util.emojiFallback({ client: this.client, message });
    const checkEmoji = emojiFallback('632444546684551183', '☑️');
    const uncheckEmoji = emojiFallback('632444550115491910', '⬜');

    const selector = new MultiSelect(this.client, message, {
      path: 'value', checkEmoji, uncheckEmoji
    }, {
      items: selectItems, _,
      display: (item) => item.name
    });
    selector.on('update', (_, item) => {
      if (!item.flag) {
        this.filterGroups[item.group].forEach(flag => {
          const flagItem = selector.pager.items.find(i => i.flag === flag);
          const flagIndex = selector.pager.items.indexOf(flagItem);
          flagItem.value = item.value;
          selector.pager.items[flagIndex] = flagItem;
        });
      } else {
        const isAllEnabled = !this.filterGroups[item.group]
          .map(flag => selector.pager.items.find(i => i.flag === flag).value)
          .includes(false);
        const groupItem = selector.pager.items.find(i => i.group === item.group && !i.flag);
        const groupIndex = selector.pager.items.indexOf(groupItem);
        groupItem.value = isAllEnabled;
        selector.pager.items[groupIndex] = groupItem;
      }
    });
    const newPerms = await selector.start(message.channel.id, message.author.id);
    if (!newPerms) return;
    await this.client.pg.models.get('webhook').update(
      { filters: new WebhookFilters(newPerms
        .filter(item => !!item.flag && item.value)
        .map(item => item.flag)).bitfield },
      { where: { id: webhook.id } });
    return message.channel.createMessage(_('webhook_cmd.filter_update'));
  }

  async repairWebhook(message, webhook, trello, userData, _) {
    const discordWebhook = await this.repairDiscordWebhook(message, webhook, _);
    if (!discordWebhook) return;
    const trelloWebhook = await this.repairTrelloWebhook(message, webhook, userData, trello, _);
    if (!trelloWebhook) return;

    await this.client.pg.models.get('webhook').update(
      { ...trelloWebhook,
        webhookID: discordWebhook.id,
        webhookToken: discordWebhook.token },
      { where: { id: webhook.id } });

    return message.channel.createMessage(_('webhook_cmd.repaired'));
  }

  async repairDiscordWebhook(message, webhook, _) {
    const discordWebhooks = await message.channel.guild.getWebhooks();
    const discordWebhook = discordWebhooks.find(dwh => dwh.id === webhook.webhookID);

    if (discordWebhook) return discordWebhook;

    const menu = new SubMenu(this.client, message, {
      header: _('webhook_cmd.repair_dwh_header'), itemTitle: 'words.subcmd.many', _ });
    const addCommand = this.client.cmds.get('addwebhook');
    const thisPatch = {
      client: this.client,
      finalizeSetup(_, __, webhook) {
        return webhook;
      }
    };
    const result = await menu.start(message.channel.id, message.author.id, null, [
      {
        // Add webhook
        names: ['add', 'addwebhook'],
        title: _('webhook_cmd.menu.add'),
        exec() {
          return addCommand.addWebhook.bind(thisPatch)(
            message, { name: _('webhook_cmd.repaired_wh') }, null, null, _);
        }
      }, {
        // Use existing webhook
        names: ['exist', 'existing', 'existingwebhook'],
        title: _('webhook_cmd.menu.exist'),
        exec() {
          return addCommand.existingWebhook.bind(thisPatch)(
            message, null, null, null, _);
        }
      }, {
        // Use webhook link
        names: ['link', 'linkwebhook'],
        title: _('webhook_cmd.menu.link'),
        exec() {
          return addCommand.linkWebhook.bind(thisPatch)(
            message, null, null, null, _);
        }
      },
    ]);

    if (result.guild_id)
      return result;
    else return false;
  }

  async repairTrelloWebhook(message, webhook, userData, trello, _) {
    const callbackURL = this.client.config.webserver.base + webhook.memberID;
    const trelloMember = await this.client.pg.models.get('user').findOne({ where: {
      trelloID: webhook.memberID
    }});
    if (!trelloMember)
      return this.createTrelloWebhook(message, webhook.modelID, userData, trello, _);
    else {
      const memberTrello = new Trello(this.client, trelloMember.trelloToken);
      const webhooksResponse = await memberTrello.getWebhooks();
      if (webhooksResponse.status === 401)
        return this.createTrelloWebhook(message, webhook.modelID, userData, trello, _);

      const body = await trello._parse(webhooksResponse);
      if (!body.length)
        return this.createTrelloWebhook(message, webhook.modelID, userData, trello, _);
      
      const trelloWebhook = body
        .find(twh => twh.idModel === webhook.modelID && twh.callbackURL === callbackURL);
      if (!trelloWebhook)
        return this.createTrelloWebhook(message, webhook.modelID, userData, trello, _);
      else if (!trelloWebhook.active)
        await memberTrello.updateWebhook(webhook.trelloWebhookID, { active: true });
      
      return {
        trelloWebhookID: webhook.trelloWebhookID,
        memberID: webhook.memberID
      };
    }
  }

  async createTrelloWebhook(message, boardID, userData, trello, _) {
    const callbackURL = this.client.config.webserver.base + userData.trelloID;
    const handle = await trello.handleResponse({
      response: await trello.addWebhook(boardID, { callbackURL }),
      client: this.client, message, _ });
    if (handle.stop) return;
    let trelloWebhook = handle.body;
    if (handle.response.status === 400 &&
      trelloWebhook === 'A webhook with that callback, model, and token already exists') {
      const webhookListHandle = await trello.handleResponse({
        response: await trello.getWebhooks(),
        client: this.client, message, _ });
      if (webhookListHandle.stop) return;
      trelloWebhook = webhookListHandle.body
        .find(twh => twh.idModel === boardID && twh.callbackURL === callbackURL);
    }

    return {
      memberID: userData.trelloID,
      trelloWebhookID: trelloWebhook.id
    };
  }

  get metadata() { return {
    category: 'categories.webhook',
  }; }
};