// --- استدعاء المكتبات ---
const { Telegraf, Markup } = require('telegraf');
const { v4: uuidv4 } = require('uuid');
const express = require('express');
const mongoose = require('mongoose');

// --- إعدادات البوت ومتغيرات البيئة ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = process.env.OWNER_ID;
const MONGO_URI = process.env.MONGO_URI;

// التحقق من وجود المتغيرات الأساسية
if (!BOT_TOKEN || !OWNER_ID || !MONGO_URI) {
    console.error("!!! خطأ فادح: يرجى تعيين متغيرات البيئة BOT_TOKEN, OWNER_ID, و MONGO_URI.");
    process.exit(1);
}

// --- إعداد خادم الويب (للاستضافة على Render) ---
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => {
  res.status(200).send('البوت يعمل بشكل سليم. خادم الويب جاهز.');
});
app.listen(port, () => {
  console.log(`خادم الويب يستمع على المنفذ ${port}`);
});

// --- الاتصال بقاعدة البيانات MongoDB ---
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('تم الاتصال بنجاح بقاعدة بيانات MongoDB.'))
    .catch(err => {
        console.error('!!! خطأ في الاتصال بقاعدة البيانات:', err);
        process.exit(1);
    });

// --- تعريف نموذج (Schema) الرسائل لقاعدة البيانات ---
const whisperSchema = new mongoose.Schema({
    messageId: { type: String, required: true, unique: true },
    senderId: { type: String, required: true },
    senderUsername: { type: String },
    targetUsers: { type: [String], required: true },
    secretMessage: { type: String, default: null },
    publicMessage: { type: String, required: true },
    createdAt: { type: Date, default: Date.now, expires: '1d' }
});

const Whisper = mongoose.model('Whisper', whisperSchema);

// --- تعريف نموذج (Schema) المستخدمين المصرح لهم ---
const authorizedUserSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    authorizedAt: { type: Date, default: Date.now }
});

const AuthorizedUser = mongoose.model('AuthorizedUser', authorizedUserSchema);

// --- تهيئة البوت ---
const bot = new Telegraf(BOT_TOKEN);

// --- الدوال المساعدة ---
function isOwner(userId) {
    return userId === parseInt(OWNER_ID, 10);
}

async function isAuthorizedUser(userId) {
    if (isOwner(userId)) return true;
    const user = await AuthorizedUser.findOne({ userId: userId.toString() });
    return user !== null;
}

function cleanUsername(username) {
    return username.toLowerCase().replace('@', '');
}

function createMentions(targetUsers) {
    return targetUsers.map(user => {
        if (/^\d+$/.test(user)) {
            return `<a href="tg://user?id=${user}">المستخدم ${user}</a>`;
        } else {
            return `@${user}`;
        }
    }).join(', ');
}

// --- معالجات أوامر البوت ---
// حماية جميع الرسائل في المحادثة الخاصة - فقط المالك يمكنه التفاعل
bot.use(async (ctx, next) => {
    // إذا كانت رسالة في محادثة خاصة وليس inline query
    if (ctx.chat && ctx.chat.type === 'private' && !ctx.inlineQuery) {
        if (!isOwner(ctx.from.id)) {
            // تجاهل الرسالة تماماً - لا رد ولا تفاعل
            return;
        }
    }
    return next();
});

bot.start((ctx) => {
    if (!isOwner(ctx.from.id)) return;
    
    const welcomeMessage = `أهلاً بك في بوت الهمس المطور!

لإرسال رسالة سرية تُقرأ لمرة واحدة فقط، اذكرني بالصيغة التالية:
\`@اسم_البوت username1,username2 - الرسالة السرية - الرسالة العامة\`

- **المستخدمين**: أسماء المستخدمين أو معرفاتهم (IDs) مفصولة بفواصل.
- **الرسالة السرية**: النص الذي سيراه المستخدمون المختارون فقط (لمرة واحدة).
- **الرسالة العامة**: النص الذي سيراه أي شخص آخر بشكل دائم.
- يجب أن يكون طول الرسالة السرية أقل من 200 حرف، والإجمالي أقل من 255 حرفًا.

ملاحظة: البوت يحذف الجزء السري فقط بعد القراءة، وتبقى الرسالة العامة متاحة.

**أوامر إدارة المستخدمين (للمالك فقط):**
• /add [user_id] - تفعيل مستخدم
• /remove [user_id] - إلغاء تفعيل مستخدم
• /list - عرض قائمة المستخدمين المفعلين`;

    ctx.replyWithMarkdown(welcomeMessage);
});

// أمر تفعيل مستخدم جديد
bot.command('add', async (ctx) => {
    if (!isOwner(ctx.from.id)) {
        return ctx.reply('⛔️ هذا الأمر متاح للمالك فقط.');
    }

    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
        return ctx.reply('❌ الرجاء إدخال معرف المستخدم.\nمثال: /add 123456789');
    }

    const userId = args[1].trim();
    
    if (!/^\d+$/.test(userId)) {
        return ctx.reply('❌ معرف المستخدم يجب أن يكون أرقام فقط.');
    }

    try {
        const existingUser = await AuthorizedUser.findOne({ userId });
        
        if (existingUser) {
            return ctx.reply('ℹ️ هذا المستخدم مفعّل مسبقاً.');
        }

        const newUser = new AuthorizedUser({ userId });
        await newUser.save();
        
        ctx.reply(`✅ تم تفعيل المستخدم بنجاح!\nالمعرف: ${userId}`);
        console.log(`تم تفعيل المستخدم: ${userId}`);
        
    } catch (error) {
        console.error('خطأ في تفعيل المستخدم:', error);
        ctx.reply('❌ حدث خطأ أثناء تفعيل المستخدم.');
    }
});

// أمر إلغاء تفعيل مستخدم
bot.command('remove', async (ctx) => {
    if (!isOwner(ctx.from.id)) {
        return ctx.reply('⛔️ هذا الأمر متاح للمالك فقط.');
    }

    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
        return ctx.reply('❌ الرجاء إدخال معرف المستخدم.\nمثال: /remove 123456789');
    }

    const userId = args[1].trim();

    try {
        const result = await AuthorizedUser.deleteOne({ userId });
        
        if (result.deletedCount === 0) {
            return ctx.reply('ℹ️ هذا المستخدم غير موجود في قائمة المفعلين.');
        }

        ctx.reply(`✅ تم إلغاء تفعيل المستخدم بنجاح!\nالمعرف: ${userId}`);
        console.log(`تم إلغاء تفعيل المستخدم: ${userId}`);
        
    } catch (error) {
        console.error('خطأ في إلغاء تفعيل المستخدم:', error);
        ctx.reply('❌ حدث خطأ أثناء إلغاء تفعيل المستخدم.');
    }
});

// أمر عرض قائمة المستخدمين المفعلين
bot.command('list', async (ctx) => {
    if (!isOwner(ctx.from.id)) {
        return ctx.reply('⛔️ هذا الأمر متاح للمالك فقط.');
    }

    try {
        const users = await AuthorizedUser.find({}).sort({ authorizedAt: -1 });
        
        if (users.length === 0) {
            return ctx.reply('📋 لا يوجد مستخدمين مفعلين حالياً.');
        }

        let message = `📋 قائمة المستخدمين المفعلين (${users.length}):\n\n`;
        users.forEach((user, index) => {
            const date = user.authorizedAt.toLocaleDateString('ar');
            message += `${index + 1}. المعرف: ${user.userId}\n   تاريخ التفعيل: ${date}\n\n`;
        });

        ctx.reply(message);
        
    } catch (error) {
        console.error('خطأ في عرض قائمة المستخدمين:', error);
        ctx.reply('❌ حدث خطأ أثناء عرض القائمة.');
    }
});

// معالج الاستعلامات المضمنة (Inline Mode)
bot.on('inline_query', async (ctx) => {
    const userId = ctx.from.id;
    const isAuth = await isAuthorizedUser(userId);
    
    if (!isAuth) {
        const unauthorizedResult = {
            type: 'article',
            id: uuidv4(),
            title: '⛔️ غير مصرح لك باستخدام البوت',
            description: 'استخدام هذا البوت مخصص للمستخدمين المفعلين فقط.',
            input_message_content: { message_text: '⛔️ عذراً، ليس لديك صلاحية استخدام هذا البوت.' }
        };
        return await ctx.answerInlineQuery([unauthorizedResult], { cache_time: 60 });
    }

    try {
        const queryText = ctx.inlineQuery.query.trim();
        const senderId = ctx.from.id.toString();
        const senderUsername = ctx.from.username ? ctx.from.username.toLowerCase() : null;

        const parts = queryText.split('-');
        
        if (parts.length < 3 || parts[0].trim() === '' || parts[1].trim() === '' || parts[2].trim() === '') {
            const errorResult = {
                type: 'article',
                id: uuidv4(),
                title: 'خطأ في التنسيق',
                description: 'استخدم: مستخدمين - رسالة سرية - رسالة عامة',
                input_message_content: { message_text: 'تنسيق خاطئ. يجب ملء جميع الأجزاء.' }
            };
            return await ctx.answerInlineQuery([errorResult], { cache_time: 1 });
        }

        const targetUsersStr = parts[0].trim();
        const publicMessage = parts.pop().trim();
        const secretMessage = parts.slice(1).join('-').trim();

        if (secretMessage.length >= 200 || queryText.length >= 255) {
            const lengthErrorResult = {
                type: 'article',
                id: uuidv4(),
                title: 'الرسالة طويلة جداً',
                description: 'الرسالة السرية يجب أن تكون أقل من 200 حرف',
                input_message_content: { message_text: 'الرسالة طويلة. الرجاء تقصيرها.' }
            };
            return await ctx.answerInlineQuery([lengthErrorResult], { cache_time: 1 });
        }

        const targetUsers = targetUsersStr.split(',').map(user => cleanUsername(user.trim())).filter(user => user.length > 0);

        if (targetUsers.length === 0) {
            const noUsersResult = {
                type: 'article',
                id: uuidv4(),
                title: 'لم يتم تحديد مستخدمين',
                description: 'يجب تحديد مستخدم واحد على الأقل',
                input_message_content: { message_text: 'لم يتم تحديد مستخدمين مستهدفين.' }
            };
            return await ctx.answerInlineQuery([noUsersResult], { cache_time: 1 });
        }

        const mentionsStr = createMentions(targetUsers);
        const msgId = uuidv4();

        const newWhisper = new Whisper({
            messageId: msgId,
            senderId: senderId,
            senderUsername: senderUsername,
            targetUsers: targetUsers,
            secretMessage: secretMessage,
            publicMessage: publicMessage
        });
        await newWhisper.save();
        console.log(`تم تخزين الرسالة ${msgId} في قاعدة البيانات.`);

        const keyboard = Markup.inlineKeyboard([
            Markup.button.callback('عرض الرد ', `whisper_${msgId}`)
        ]);

        const result = {
            type: 'article',
            id: msgId,
            title: 'رسالة همس جاهزة للإرسال',
            description: `موجهة إلى: ${targetUsers.join(', ')}`,
            input_message_content: {
                message_text: `هذا الرد موجه إلى ${mentionsStr}\n\nعزيزي/تي اضغط على الزر ادناه لعرضه.`,
                parse_mode: 'HTML'
            },
            reply_markup: keyboard.reply_markup
        };

        await ctx.answerInlineQuery([result], { cache_time: 1 });

    } catch (error) {
        console.error('خطأ في معالج inline:', error);
    }
});

// --- معالج ردود الأزرار المضمنة (Callback Query) ---
bot.action(/^whisper_(.+)$/, async (ctx) => {
    try {
        const msgId = ctx.match[1];
        const clickerId = ctx.from.id.toString();
        const clickerUsername = ctx.from.username ? ctx.from.username.toLowerCase() : null;

        const messageData = await Whisper.findOne({ messageId: msgId });

        if (!messageData) {
            return await ctx.answerCbQuery('عذراً، هذه الرسالة لم تعد متوفرة أو انتهت صلاحيتها.', { show_alert: true });
        }

        const isAuthorized = messageData.senderId === clickerId || 
                             messageData.targetUsers.includes(clickerId) ||
                             (clickerUsername && messageData.targetUsers.includes(clickerUsername));

        if (isAuthorized) {
            if (messageData.secretMessage) {
                const secretPart = messageData.secretMessage;
                const publicPart = messageData.publicMessage;
                
                const fullMessageToShow = `🤫 هاي الرسالة سرية بس انت تشوفها بقية الطلاب لا :\n${secretPart}\n\n---\n\n📢 الرسالة العامة (اللي الكل يشوفها بدل الرسالة السرية):\n${publicPart}\n\n`;

                await ctx.answerCbQuery(fullMessageToShow, { show_alert: true });
                
                await Whisper.updateOne({ messageId: msgId }, { $set: { secretMessage: null } });
                console.log(`تم عرض وحذف الجزء السري من الرسالة ${msgId} للمستخدم ${clickerId}`);

            } else {
                await ctx.answerCbQuery(`...\n\nالرسالة العامة :\n"${messageData.publicMessage}"`, { show_alert: true });
            }
        } else {
            await ctx.answerCbQuery(messageData.publicMessage, { show_alert: true });
            console.log(`تم عرض الرسالة العامة للرسالة ${msgId} للمستخدم غير المصرح له ${clickerId}`);
        }

    } catch (error) {
        console.error('خطأ في معالج callback:', error);
        await ctx.answerCbQuery('حدث خطأ ما أثناء معالجة طلبك.', { show_alert: true });
    }
});

// بدء تشغيل البوت
console.log('بدء تشغيل البوت...');
bot.launch()
    .then(() => console.log('تم تشغيل البوت بنجاح!'))
    .catch((error) => console.error('خطأ في تشغيل البوت:', error));

// التعامل مع إيقاف البوت بشكل صحيح
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
