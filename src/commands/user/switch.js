/*
This file is part of Taco

MIT License

Copyright (c) 2020 Trello Talk

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

const Command = require('../../structures/Command');
const Util = require('../../util');

module.exports = class Switch extends Command {
  get name() { return 'switch'; }

  get _options() { return {
    aliases: ['switchboard', 'select', 'selectboard'],
    cooldown: 2,
    permissions: ['auth']
  }; }

  async exec(message, { args, _, trello, userData }) {
    const handle = await trello.handleResponse({
      response: await trello.getMember(userData.trelloID),
      client: this.client, message, _ });
    if (handle.stop) return;
    if (handle.response.status === 404) {
      await this.client.pg.models.get('user').removeAuth(message.author);
      return message.channel.createMessage(_('trello_response.unauthorized'));
    }

    const json = handle.body;

    const board = await Util.Trello.findBoard(args.join(' '), json.boards, this.client, message, _, userData);
    if (!board) return;

    await this.client.pg.models.get('user').update({ currentBoard: board.id },
      { where: { userID: message.author.id } });
    
    const emojiFallback = Util.emojiFallback({ client: this.client, message });
    const doneEmoji = emojiFallback('632444546684551183', ':white_check_mark:');
    return message.channel.createMessage(`${doneEmoji} ` + _('boards.switch', {
      name: Util.cutoffText(Util.Escape.markdown(board.name), 50),
      id: board.shortLink
    }));
  }

  get metadata() { return {
    category: 'categories.user',
  }; }
};