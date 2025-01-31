import { api, dbWatchersDisabled } from '@rocket.chat/core-services';
import type { IMessage, IUser, MessageTypesValues } from '@rocket.chat/core-typings';
import { Messages, Settings, Users } from '@rocket.chat/models';
import mem from 'mem';

import { shouldHideSystemMessage } from '../../../lib/systemMessage/hideSystemMessage';

const getUserNameCached = mem(
	async (userId: string): Promise<string | undefined> => {
		const user = await Users.findOne<Pick<IUser, 'name'>>(userId, { projection: { name: 1 } });
		return user?.name;
	},
	{ maxAge: 10000 },
);

const getSettingCached = mem(Settings.getValueById, { maxAge: 10000 });

export async function getMessageToBroadcast({ id, data }: { id: IMessage['_id']; data?: IMessage }): Promise<IMessage | void> {
	const message = data ?? (await Messages.findOneById(id));
	if (!message) {
		return;
	}

	if (message.t) {
		const hiddenSystemMessages = (await getSettingCached('Hide_System_Messages')) as MessageTypesValues[];
		const shouldHide = shouldHideSystemMessage(message.t, hiddenSystemMessages);

		if (shouldHide) {
			return;
		}
	}

	if (message._hidden || message.imported != null) {
		return;
	}

	const useRealName = (await getSettingCached('UI_Use_Real_Name')) === true;
	if (useRealName) {
		if (message.u?._id) {
			const name = await getUserNameCached(message.u._id);
			if (name) {
				message.u.name = name;
			}
		}

		if (message.mentions?.length) {
			for await (const mention of message.mentions) {
				const name = await getUserNameCached(mention._id);
				if (name) {
					mention.name = name;
				}
			}
		}
	}

	return message;
}

// TODO once the broadcast from file apps/meteor/server/modules/watchers/watchers.module.ts is removed
// this function can be renamed to broadcastMessage
export async function broadcastMessageFromData({ id, data }: { id: IMessage['_id']; data?: IMessage }): Promise<void> {
	// if db watchers are active, the event will be triggered automatically so we don't need to broadcast it here.
	if (!dbWatchersDisabled) {
		return;
	}
	const message = await getMessageToBroadcast({ id, data });
	if (!message) {
		return;
	}
	void api.broadcast('watch.messages', { message });
}
