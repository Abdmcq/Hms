// --- استدعاء المكتبات ---
const { Telegraf, Markup } = require('telegraf');
const { v4: uuidv4 } = require('uuid');
const express = require('express');
const mongoose = require('mongoose');

// --- إعدادات البوت ومتغيرات البيئة ---
// !! مهم !!
// يتم الآن قراءة كل الإعدادات من متغيرات البيئة (Environment Variables)
const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = process.env.OWNER_ID;
const MONGO_URI = process.env.MONGO_URI; // الرابط لقاعدة بيانات MongoDB

// التحقق من وجود المتغيرات الأساسية
if (!BOT_TOKEN || !OWNER_ID || !MONGO_URI) {
    console.error("!!! خطأ فادح: يرجى تعيين متغيرات البيئة BOT_TOKEN, OWNER_ID, و MONGO_URI قبل تشغيل البوت.");
    process.exit(1); // إيقاف التشغيل إذا لم يتم توفير المتغيرات
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
    secretMessage: { type: String, required: true },
    publicMessage: { type: String, required: true },
    createdAt: { type: Date, default: Date.now, expires: '1d' } // حذف الرسالة تلقائياً بعد يوم واحد
});

const Whisper = mongoose.model('Whisper', whisperSchema);


// --- تهيئة البوت ---
const bot = new Telegraf(BOT_TOKEN);

// --- الدوال المساعدة ---

// دالة للتحقق من صلاحية المستخدم (المالك)
function isOwner(userId) {
    return userId === parseInt(OWNER_ID, 10);
}

// دالة لتنظيف أسماء المستخدمين
function cleanUsername(username) {
    return username.toLowerCase().replace('@', '');
}

// دالة لإنشاء mentions للمستخدمين
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

// معالج أمر /start
bot.start((ctx) => {
    if (!isOwner(ctx.from.id)) return;
    
    const welcomeMessage = `أهلاً بك في بوت الهمس المطور!

لإرسال رسالة سرية تُقرأ لمرة واحدة فقط، اذكرني بالصيغة التالية:
\`@اسم_البوت username1,username2 - الرسالة السرية - الرسالة العامة\`

- **المستخدمين**: أسماء المستخدمين أو معرفاتهم (IDs) مفصولة بفواصل.
- **الرسالة السرية**: النص الذي سيراه المستخدمون المختارون فقط (لمرة واحدة).
- **الرسالة العامة**: النص الذي سيراه أي شخص آخر.
- يجب أن يكون طول الرسالة السرية أقل من 200 حرف، والإجمالي أقل من 255 حرفًا.

ملاحظة: البوت يعمل الآن مع قاعدة بيانات، والرسائل تُحذف بعد القراءة أو بعد مرور 24 ساعة.`;

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
        
        if (parts.length < 3) {
            const errorResult = {
                type: 'article',
                id: uuidv4(),
                title: 'خطأ في التنسيق',
                description: 'استخدم: مستخدمين - رسالة سرية - رسالة عامة',
                input_message_content: { message_text: 'تنسيق خاطئ. يرجى مراجعة /start' }
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
                title: 'خطأ: الرسالة طويلة جدًا',
                description: `السرية: ${secretMessage.length}/199, الإجمالي: ${queryText.length}/254`,
                input_message_content: { message_text: 'الرسالة طويلة جدًا. يرجى مراجعة /start' }
            };
            return await ctx.answerInlineQuery([lengthErrorResult], { cache_time: 1 });
        }

        const targetUsers = targetUsersStr.split(',')
            .map(user => cleanUsername(user.trim()))
            .filter(user => user.length > 0);

        if (targetUsers.length === 0) {
            const noUsersResult = {
                type: 'article',
                id: uuidv4(),
                title: 'خطأ: لم يتم تحديد مستخدمين',
                description: 'يجب تحديد مستخدم واحد على الأقل.',
                input_message_content: { message_text: 'لم يتم تحديد مستخدمين. يرجى مراجعة /start' }
            };
            return await ctx.answerInlineQuery([noUsersResult], { cache_time: 1 });
        }

        const mentionsStr = createMentions(targetUsers);
        const msgId = uuidv4();

        // **الجديد هنا: حفظ الرسالة في قاعدة البيانات**
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
            Markup.button.callback('إظهار الرد (لمرة واحدة)', `whisper_${msgId}`)
        ]);

        const result = {
            type: 'article',
            id: msgId,
            title: 'رسالة همس (تُقرأ مرة واحدة) جاهزة للإرسال',
            description: `موجهة إلى: ${targetUsers.join(', ')}`,
            input_message_content: {
                message_text: `همسة موجهة إلى ${mentionsStr}\n\nاضغط على الزر أدناه لكشف الرسالة. (يمكن قراءتها مرة واحدة فقط!)`,
                parse_mode: 'HTML'
            },
            reply_markup: keyboard.reply_markup
        };

        await ctx.answerInlineQuery([result], { cache_time: 1 });

    } catch (error) {
        console.error('خطأ في معالج inline:', error);
    }
});

// معالج ردود الأزرار المضمنة (Callback Query)
// معالج ردود الأزرار المضمنة (Callback Query)
bot.action(/^whisper_(.+)$/, async (ctx) => {
    try {
        const msgId = ctx.match[1];
        const clickerId = ctx.from.id.toString();
        const clickerUsername = ctx.from.username ? ctx.from.username.toLowerCase() : null;

        // **البحث عن الرسالة في قاعدة البيانات**
        const messageData = await Whisper.findOne({ messageId: msgId });

        if (!messageData) {
            // -- هذا هو السطر الذي تم تصحيحه --
            return await ctx.answerCbQuery('عزيزي/تي هاي الرسالة تم قرائتها او انتهت صلاحيتها ونحذفت.', { show_alert: true });
        }

        const isAuthorized = messageData.senderId === clickerId || 
                             messageData.targetUsers.includes(clickerId) ||
                             (clickerUsername && messageData.targetUsers.includes(clickerUsername));

        if (isAuthorized) {
            let messageToShow = messageData.secretMessage;
            messageToShow += `\n\n(هذه الرسالة تم حذفها الآن ولن يتمكن أحد من قراءتها مجدداً)`;
            
            await ctx.answerCbQuery(messageToShow, { show_alert: true });
            
            // **حذف الرسالة بعد قراءتها**
            await Whisper.deleteOne({ messageId: msgId });
            console.log(`تم عرض وحذف الرسالة ${msgId} للمستخدم ${clickerId}`);

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
    .then(() => {
        console.log('تم تشغيل البوت بنجاح!');
    })
    .catch((error) => {
        console.error('خطأ في تشغيل البوت:', error);
    });

// التعامل مع إيقاف البوت بشكل صحيح
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
