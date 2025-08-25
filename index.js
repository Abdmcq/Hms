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
// ** تعديل هنا: تم تغيير secretMessage **
const whisperSchema = new mongoose.Schema({
    messageId: { type: String, required: true, unique: true },
    senderId: { type: String, required: true },
    senderUsername: { type: String },
    targetUsers: { type: [String], required: true },
    secretMessage: { type: String, default: null }, // سيتم تحديثه إلى null بعد القراءة
    publicMessage: { type: String, required: true },
    createdAt: { type: Date, default: Date.now, expires: '1d' } // لا يزال يحذف المستند بالكامل بعد يوم واحد
});

const Whisper = mongoose.model('Whisper', whisperSchema);


// --- تهيئة البوت ---
const bot = new Telegraf(BOT_TOKEN);

// --- الدوال المساعدة ---
function isOwner(userId) {
    return userId === parseInt(OWNER_ID, 10);
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
bot.start((ctx) => {
    if (!isOwner(ctx.from.id)) return;
    
    const welcomeMessage = `أهلاً بك في بوت الهمس المطور!

لإرسال رسالة سرية تُقرأ لمرة واحدة فقط، اذكرني بالصيغة التالية:
\`@اسم_البوت username1,username2 - الرسالة السرية - الرسالة العامة\`

- **المستخدمين**: أسماء المستخدمين أو معرفاتهم (IDs) مفصولة بفواصل.
- **الرسالة السرية**: النص الذي سيراه المستخدمون المختارون فقط (لمرة واحدة).
- **الرسالة العامة**: النص الذي سيراه أي شخص آخر بشكل دائم.
- يجب أن يكون طول الرسالة السرية أقل من 200 حرف، والإجمالي أقل من 255 حرفًا.

ملاحظة: البوت يحذف الجزء السري فقط بعد القراءة، وتبقى الرسالة العامة متاحة.`;

    ctx.replyWithMarkdown(welcomeMessage);
});


// معالج الاستعلامات المضمنة (Inline Mode)
bot.on('inline_query', async (ctx) => {
    if (!isOwner(ctx.from.id)) {
        const unauthorizedResult = {
            type: 'article',
            id: uuidv4(),
            title: 'عزيزي/تي البوت يعمل فقط عند عبدالرحمن حسن',
            description: 'استخدام هذا البوت مخصص للمطور عبدالرحمن حسن فقط.',
            input_message_content: { message_text: 'عيني ماعدكم صلاحية استخدام البوت' }
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
            const lengthErrorResult = { /* ... */ }; // (الكود كما هو)
            return await ctx.answerInlineQuery([lengthErrorResult], { cache_time: 1 });
        }

        const targetUsers = targetUsersStr.split(',').map(user => cleanUsername(user.trim())).filter(user => user.length > 0);

        if (targetUsers.length === 0) {
            const noUsersResult = { /* ... */ }; // (الكود كما هو)
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
// ** تم إعادة كتابة هذا الجزء بالكامل **
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
            // تحقق مما إذا كانت الرسالة السرية لا تزال موجودة
            if (messageData.secretMessage) {
                // هذه هي المرة الأولى للقراءة
                const secretPart = messageData.secretMessage;
                const publicPart = messageData.publicMessage;
                
                // إنشاء الرسالة المدمجة (السرية + العامة)
                const fullMessageToShow = `🤫 هاي الرسالة سرية بس انت تشوفها بقية الطلاب لا :\n"${secretPart}"\n\n---\n\n📢 الرسالة العامة (اللي الكل يشوفها بدل الرسالة السرية):\n"${publicPart}"\n\n`;

                await ctx.answerCbQuery(fullMessageToShow, { show_alert: true });
                
                // تحديث المستند لإزالة الرسالة السرية بدلاً من حذف المستند بأكمله
                await Whisper.updateOne({ messageId: msgId }, { $set: { secretMessage: null } });
                console.log(`تم عرض وحذف الجزء السري من الرسالة ${msgId} للمستخدم ${clickerId}`);

            } else {
                // الرسالة السرية قد قُرأت بالفعل
                await ctx.answerCbQuery(`تمت قراءة الجزء الخاص من هذه الرسالة مسبقاً.\n\nالرسالة العامة المتبقية هي:\n"${messageData.publicMessage}"`, { show_alert: true });
            }
        } else {
            // المستخدم غير مصرح له، يرى الرسالة العامة فقط
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
