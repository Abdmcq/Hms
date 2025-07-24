// --- استدعاء المكتبات المطلوبة ---
const { Telegraf, Markup } = require('telegraf'); // مكتبة تيليجرام الأساسية
const { v4: uuidv4 } = require('uuid');         // لإنشاء معرفات فريدة للرسائل
const express = require('express');             // لإنشاء خادم ويب (مهم لـ Render و UptimeRobot)

// --- إعدادات البوت الأساسية ---
// !! مهم جداً !!
// أدخل توكن البوت الخاص بك بين علامتي الاقتباس بدلاً من النص الحالي
const BOT_TOKEN = "7487838353:AAFmFXZ0PzjeFCz3x6rorCMlN_oBBzDyzEQ"; 
// !! مهم جداً !!
// استبدل 0 بالـ ID الرقمي الخاص بحسابك (مالك البوت)
const OWNER_ID = 1749717270;

// --- التحقق من إدخال القيم ---
// هذا الكود يتأكد من أنك قمت بتغيير القيم الافتراضية قبل تشغيل البوت
if (BOT_TOKEN === "ادخل توكن البوت الخاص بك هنا" || OWNER_ID === 0) {
    console.error("!!! خطأ فادح: يرجى إدخال توكن البوت والـ ID الخاص بالمالك في ملف index.js قبل التشغيل.");
    process.exit(1); // إيقاف التشغيل إذا لم يتم إدخال القيم
}

// --- إعداد خادم الويب (لضمان عمل البوت 24/7) ---
const app = express();
const port = process.env.PORT || 3000; // سيستخدم المنفذ الذي يوفره Render تلقائياً

// هذا هو المسار الذي سيقوم UptimeRobot بزيارته بشكل دوري
app.get('/', (req, res) => {
  res.status(200).send('البوت يعمل بشكل سليم. خادم الويب جاهز.');
});

// تشغيل خادم الويب
app.listen(port, () => {
  console.log(`خادم الويب يستمع على المنفذ ${port}`);
});


// --- تهيئة البوت ومنطقه الأساسي ---
const bot = new Telegraf(BOT_TOKEN);

// متغير لتخزين الرسائل في الذاكرة المؤقتة
const messageStore = {};

// دالة للتحقق مما إذا كان المستخدم هو المالك
function isOwner(userId) {
    return userId === OWNER_ID;
}

// دالة لتنظيف أسماء المستخدمين (إزالة @ وتحويلها لأحرف صغيرة)
function cleanUsername(username) {
    return username.toLowerCase().replace('@', '');
}

// دالة لإنشاء روابط mention للمستخدمين في الرسالة
function createMentions(targetUsers) {
    return targetUsers.map(user => {
        if (/^\d+$/.test(user)) { // إذا كان معرفاً رقمياً
            return `<a href="tg://user?id=${user}">المستخدم ${user}</a>`;
        } else { // إذا كان اسم مستخدم
            return `@${user}`;
        }
    }).join(', ');
}

// --- أوامر البوت ---

// معالج أمر /start
bot.start((ctx) => {
    if (!isOwner(ctx.from.id)) return; // يتجاهل الأمر إذا لم يكن من المالك
    
    const welcomeMessage = `أهلاً بك في بوت الهمس!

لإرسال رسالة سرية، اذكرني في أي مجموعة بالصيغة التالية:
\`@اسم_البوت username - الرسالة السرية - الرسالة العامة\`

- \`username\`: اسم مستخدم واحد أو أكثر (أو ID) مفصولة بفواصل.
- \`الرسالة السرية\`: تظهر فقط للمستخدمين المحددين.
- \`الرسالة العامة\`: تظهر لأي شخص آخر يضغط على الزر.`;

    ctx.replyWithMarkdown(welcomeMessage);
});

// معالج أمر /help (يعرض نفس رسالة البدء)
bot.help((ctx) => {
    if (!isOwner(ctx.from.id)) return;
    bot.telegram.sendMessage(ctx.chat.id, (ctx.message.text.replace('/help', '/start')));
});


// --- المنطق الأساسي للبوت (الوضع المضمن) ---

bot.on('inline_query', async (ctx) => {
    if (!isOwner(ctx.from.id)) {
        // رسالة للمستخدمين غير المصرح لهم
        return await ctx.answerInlineQuery([{
            type: 'article',
            id: 'unauthorized',
            title: 'ممنوع تستخدم البوت',
            description: 'هذا البوت مخصص لمبرمجه عبدالرحمن حسن فقط.',
            input_message_content: { message_text: 'عزيزي مايصير تستخدم البوت.' }
        }]);
    }

    try {
        const queryText = ctx.inlineQuery.query.trim();
        const senderId = ctx.from.id.toString();

        // تقسيم النص باستخدام الفاصل "-"
        const parts = queryText.split('-');
        
        // التحقق من أن الصيغة صحيحة (يجب أن تحتوي على 3 أجزاء على الأقل)
        if (parts.length < 3) {
            return await ctx.answerInlineQuery([{
                type: 'article',
                id: 'format_error',
                title: 'خطأ في الصيغة',
                description: 'الصيغة الصحيحة: مستخدمين - رسالة سرية - رسالة عامة',
                input_message_content: { message_text: 'صيغة الرسالة غير صحيحة. راجع /help' }
            }], { cache_time: 1 });
        }

        // استخراج الأجزاء المختلفة من النص
        const targetUsersStr = parts[0].trim();
        const publicMessage = parts.pop().trim();
        const secretMessage = parts.slice(1).join('-').trim();

        // التحقق من أن أي جزء ليس فارغاً
        if (!targetUsersStr || !secretMessage || !publicMessage) {
             return await ctx.answerInlineQuery([{
                type: 'article',
                id: 'empty_error',
                title: 'خطأ: أحد الحقول فارغ',
                description: 'تأكد من ملء جميع الأجزاء: المستخدمين، الرسالة السرية، والعامة.',
                input_message_content: { message_text: 'أحد الحقول فارغ. يرجى مراجعة /help' }
            }], { cache_time: 1 });
        }

        // معالجة قائمة المستخدمين المستهدفين
        const targetUsers = targetUsersStr.split(',').map(user => cleanUsername(user.trim())).filter(Boolean);

        if (targetUsers.length === 0) {
            return await ctx.answerInlineQuery([{
                type: 'article',
                id: 'no_users_error',
                title: 'خطأ: لم يتم تحديد مستخدمين',
                input_message_content: { message_text: 'يجب تحديد مستخدم واحد على الأقل.' }
            }], { cache_time: 1 });
        }

        // إنشاء معرف فريد وتخزين بيانات الرسالة
        const msgId = uuidv4();
        messageStore[msgId] = { senderId, targetUsers, secretMessage, publicMessage };

        // إنشاء الزر الذي سيظهر تحت الرسالة
        const keyboard = Markup.inlineKeyboard([
            Markup.button.callback('🔒 إظهار الرسالة', `whisper_${msgId}`)
        ]);
        
        // تجهيز النتيجة لإرسالها
        const result = {
            type: 'article',
            id: msgId,
            title: 'رسالة همس جاهزة للإرسال',
            description: `موجهة إلى: ${targetUsers.join(', ')}`,
            input_message_content: {
                message_text: `رسالة همس موجهة إلى ${createMentions(targetUsers)}.\n\nاضغط على الزر أدناه لقراءة الرسالة.`,
                parse_mode: 'HTML'
            },
            reply_markup: keyboard.reply_markup
        };

        await ctx.answerInlineQuery([result], { cache_time: 1 });

    } catch (error) {
        console.error('خطأ في معالج inline_query:', error);
    }
});

// معالج الضغط على الأزرار
bot.action(/^whisper_(.+)$/, async (ctx) => {
    try {
        const msgId = ctx.match[1];
        const clickerId = ctx.from.id.toString();
        const clickerUsername = ctx.from.username ? cleanUsername(ctx.from.username) : null;
        
        const messageData = messageStore[msgId];

        if (!messageData) {
            return await ctx.answerCbQuery('عذراً، هذه الرسالة لم تعد متوفرة أو منتهية الصلاحية.', { show_alert: true });
        }

        // التحقق مما إذا كان المستخدم الحالي مصرح له برؤية الرسالة السرية
        const isAuthorized = messageData.senderId === clickerId ||
                             messageData.targetUsers.includes(clickerId) ||
                             (clickerUsername && messageData.targetUsers.includes(clickerUsername));

        if (isAuthorized) {
            await ctx.answerCbQuery(messageData.secretMessage, { show_alert: true });
        } else {
            await ctx.answerCbQuery(messageData.publicMessage, { show_alert: true });
        }
    } catch (error) {
        console.error('خطأ في معالج bot.action:', error);
        await ctx.answerCbQuery('حدث خطأ ما.', { show_alert: true });
    }
});

// --- تشغيل البوت ---
console.log('جاري بدء تشغيل البوت...');
bot.launch()
    .then(() => {
        console.log('تم تشغيل البوت بنجاح ويعمل الآن!');
    })
    .catch((error) => {
        console.error('فشل تشغيل البوت:', error);
    });

// التعامل مع إيقاف البوت بشكل صحيح لضمان عدم حدوث أخطاء
process.once('SIGINT', () => { bot.stop('SIGINT'); process.exit(0); });
process.once('SIGTERM', () => { bot.stop('SIGTERM'); process.exit(0); });

