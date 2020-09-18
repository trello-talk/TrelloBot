const Command = require('../../structures/Command');
const Util = require('../../util');

module.exports = class Label extends Command {
  get name() { return 'label'; }

  get _options() { return {
    aliases: ['viewlabel', 'vlb'],
    cooldown: 2,
    permissions: ['embed', 'auth', 'selectedBoard']
  }; }

  get colorMap() {
    return {
      [null]: 0,
      green: 0x61bd4f,
      yellow: 0xf2d600,
      red: 0xeb5a46,
      orange: 0xff9f1a,
      lime: 0x51e898,
      purple: 0xc377e0,
      blue: 0x0079bf,
      sky: 0x00c2e0,
      pink: 0xc9558f,
      black: 0x344563
    };
  }

  async exec(message, { args, _, trello, userData }) {
    const handle = await trello.handleResponse({
      response: await trello.getLabels(userData.currentBoard),
      client: this.client, message, _ });
    if (handle.stop) return;
    if (Util.Trello.cannotUseBoard(handle)) {
      await this.client.pg.models.get('user').update({ currentBoard: null },
        { where: { userID: message.author.id } });
      return message.channel.createMessage(_('boards.gone'));
    }

    const json = handle.body;
    const label = await Util.Trello.findLabel(args[0], json, this.client, message, _);
    if (!label) return;

    const embed = {
      title: Util.cutoffText(Util.Escape.markdown(label.name), 256),
      color: this.colorMap[label.color],
      description: `**${_('words.id')}:** \`${label.id}\`\n` +
        (label.color ? `**${_('words.color.one')}:** ${_(`trello.label_color.${label.color}`)}\n` : '')
    };
    return message.channel.createMessage({ embed });
  }

  get metadata() { return {
    category: 'categories.view',
  }; }
};