const { Telegraf, Markup } = require('telegraf');
const { v4: uuidv4 } = require('uuid');
const express = require('express');   
// --- إعدادات البوت ---
// !! مهم !!
// أدخل توكن البوت الخاص بك بين علامتي الاقتباس
const BOT_TOKEN = "7487838353:AAFmFXZ0PzjeFCz3x6rorCMlN_oBBzDyzEQ";
// !! مهم !!
// استبدل 0 بالـ ID الرقمي الخاص بمالك البوت
const OWNER_ID = 1749717270; 

// التحقق من إدخال القيم
if (BOT_TOKEN === "ادخل توكن البوت الخاص بك هنا" || OWNER_ID === 0) {
    console.error("!!! خطأ فادح: يرجى إدخال توكن البوت والـ ID الخاص بالمالك في ملف index.js قبل تشغيل البوت.");
    process.exit(1); // إيقاف التشغيل إذا لم يتم إدخال القيم
}

const app = express();
const port = process.env.PORT || 3000; // سيستخدم المنفذ الذي يوفره Render تلقائياً

// هذا هو المسار الذي سيقوم UptimeRobot بزيارته بشكل دوري
app.get('/', (req, res) => {
  res.status(200).send('البوت يعمل بشكل سليم. خادم الويب جاهز.');
});

// تشغيل خادم الويب
app.listen(port, () => {
  console.log(خادم الويب يستمع على المنفذ ${port});
});

// تهيئة البوت
const bot = new Telegraf(BOT_TOKEN);

// تخزين الرسائل في الذاكرة
const messageStore = {};

// دالة للتحقق من صلاحية المستخدم
function isOwner(userId) {
    return userId === OWNER_ID;
}

// دالة لتنظيف أسماء المستخدمين
function cleanUsername(username) {
    return username.toLowerCase().replace('@', '');
}

// دالة لإنشاء mentions للمستخدمين
function createMentions(targetUsers) {
    return targetUsers.map(user => {
        if (/^\d+$/.test(user)) {
            // إذا كان رقم ID
            return `<a href="tg://user?id=${user}">المستخدم ${user}</a>`;
        } else {
            // إذا كان username
            return `@${user}`;
        }
    }).join(', ');
}

// معالج أمر /start
bot.start((ctx) => {
    if (!isOwner(ctx.from.id)) {
        console.log(`تجاهل أمر /start من مستخدم غير مصرح له: ${ctx.from.id}`);
        return;
    }
    
    // تم تحديث رسالة الترحيب لتعكس الفاصل الجديد (-)
    const welcomeMessage = `أهلاً بك في بوت الهمس!

لإرسال رسالة سرية في مجموعة، اذكرني في شريط الرسائل بالصيغة التالية:
\`@اسم_البوت username1,username2 - الرسالة السرية - الرسالة العامة\`

- استبدل \`username1,username2\` بأسماء المستخدمين أو معرفاتهم (IDs) مفصولة بفواصل.
- \`الرسالة السرية\` هي النص الذي سيظهر فقط للمستخدمين المحددين.
- \`الرسالة العامة\` هي النص الذي سيظهر لبقية أعضاء المجموعة عند محاولة قراءة الرسالة.
- يجب أن يكون طول الرسالة السرية أقل من 200 حرف، والطول الإجمالي أقل من 255 حرفًا.

ملاحظة: لا تحتاج لإضافة البوت إلى المجموعة لاستخدامه.`;

    ctx.replyWithMarkdown(welcomeMessage);
});

// معالج أمر /help
bot.help((ctx) => {
    if (!isOwner(ctx.from.id)) {
        console.log(`تجاهل أمر /help من مستخدم غير مصرح له: ${ctx.from.id}`);
        return;
    }
    
    // نفس رسالة /start
    ctx.telegram.sendMessage(ctx.chat.id, ctx.message.text.replace('/help', '/start'));
});

// معالج الاستعلامات المضمنة (Inline Mode)
bot.on('inline_query', async (ctx) => {
    if (!isOwner(ctx.from.id)) {
        console.log(`تجاهل inline query من مستخدم غير مصرح له: ${ctx.from.id}`);
        
        const unauthorizedResult = {
            type: 'article',
            id: uuidv4(),
            title: 'عزيزي ما مسموحلك تستخدم البوت',
            description: 'هذا البوت مخصص لمبرمجه عبدالرحمن حسن فقط.',
            input_message_content: {
                message_text: 'مايصير تستخدم البوت إلا بتصريح من مبرمجه.'
            }
        };
        
        try {
            await ctx.answerInlineQuery([unauthorizedResult], { cache_time: 60 });
        } catch (error) {
            console.error(`خطأ في إرسال رسالة عدم التصريح للمستخدم ${ctx.from.id}:`, error);
        }
        return;
    }

    try {
        const queryText = ctx.inlineQuery.query.trim();
        const senderId = ctx.from.id.toString();
        const senderUsername = ctx.from.username ? ctx.from.username.toLowerCase() : null;

        // تم تحديث الفاصل هنا من || إلى -
        const parts = queryText.split('-');
        
        if (parts.length < 3) { // نستخدم أقل من 3 للسماح بوجود - داخل الرسائل
            const errorResult = {
                type: 'article',
                id: uuidv4(),
                title: 'خطأ في التنسيق',
                // تم تحديث رسالة الخطأ
                description: 'يرجى استخدام: مستخدمين - رسالة سرية - رسالة عامة',
                input_message_content: {
                    message_text: 'تنسيق خاطئ. يرجى مراجعة /help'
                }
            };
            
            await ctx.answerInlineQuery([errorResult], { cache_time: 1 });
            return;
        }

        // إعادة تجميع الأجزاء بشكل صحيح للسماح بوجود "-" في الرسائل
        const targetUsersStr = parts[0].trim();
        const publicMessage = parts.pop().trim(); // الجزء الأخير هو الرسالة العامة
        const secretMessage = parts.slice(1).join('-').trim(); // كل ما في الوسط هو الرسالة السرية

        // التحقق من طول الرسائل
        if (secretMessage.length >= 200 || queryText.length >= 255) {
            const lengthErrorResult = {
                type: 'article',
                id: uuidv4(),
                title: 'خطأ: الرسالة طويلة جدًا',
                description: `السرية: ${secretMessage.length}/199, الإجمالي: ${queryText.length}/254`,
                input_message_content: {
                    message_text: 'الرسالة طويلة جدًا. يرجى مراجعة /help'
                }
            };
            
            await ctx.answerInlineQuery([lengthErrorResult], { cache_time: 1 });
            return;
        }

        // تنظيف قائمة المستخدمين المستهدفين
        const targetUsers = targetUsersStr.split(',')
            .map(user => cleanUsername(user.trim()))
            .filter(user => user.length > 0);

        if (targetUsers.length === 0) {
            const noUsersResult = {
                type: 'article',
                id: uuidv4(),
                title: 'خطأ: لم يتم تحديد مستخدمين',
                description: 'يجب تحديد مستخدم واحد على الأقل.',
                input_message_content: {
                    message_text: 'لم يتم تحديد مستخدمين. يرجى مراجعة /help'
                }
            };
            
            await ctx.answerInlineQuery([noUsersResult], { cache_time: 1 });
            return;
        }

        // إنشاء mentions للمستخدمين
        const mentionsStr = createMentions(targetUsers);

        // إنشاء معرف فريد للرسالة وتخزينها
        const msgId = uuidv4();
        messageStore[msgId] = {
            senderId: senderId,
            senderUsername: senderUsername,
            targetUsers: targetUsers,
            secretMessage: secretMessage,
            publicMessage: publicMessage
        };

        console.log(`تم تخزين الرسالة ${msgId}:`, messageStore[msgId]);

        // إنشاء الزر المضمن
        const keyboard = Markup.inlineKeyboard([
            Markup.button.callback('إظهار الرد الذكي', `whisper_${msgId}`)
        ]);

        // إنشاء نتيجة الاستعلام المضمن
        const result = {
            type: 'article',
            id: msgId,
            title: 'رسالة همس جاهزة للإرسال',
            description: `موجهة إلى: ${targetUsers.join(', ')}`,
            input_message_content: {
                message_text: `تم كتابة الرد عبر الصوت لـ ${mentionsStr}\n\nعزيزي/تي دوس على الزر حتى تشوف`,
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
bot.action(/^whisper_(.+)$/, async (ctx) => {
    try {
        const msgId = ctx.match[1];
        const clickerId = ctx.from.id.toString();
        const clickerUsername = ctx.from.username ? ctx.from.username.toLowerCase() : null;

        console.log(`تم استلام callback للرسالة: ${msgId} من المستخدم: ${clickerId} (@${clickerUsername})`);

        const messageData = messageStore[msgId];

        if (!messageData) {
            await ctx.answerCbQuery('عذراً، هذه الرسالة لم تعد متوفرة أو انتهت صلاحيتها.', { show_alert: true });
            console.warn(`معرف الرسالة ${msgId} غير موجود في المخزن.`);
            return;
        }

        let isAuthorized = false;
        
        if (clickerId === messageData.senderId) {
            isAuthorized = true;
        } else {
            for (const target of messageData.targetUsers) {
                if (target === clickerId || (clickerUsername && target === clickerUsername)) {
                    isAuthorized = true;
                    break;
                }
            }
        }

        console.log(`حالة التصريح للمستخدم ${clickerId} للرسالة ${msgId}: ${isAuthorized}`);

        if (isAuthorized) {
            let messageToShow = messageData.secretMessage;
            messageToShow += `\n\n(ملاحظة بقية الطلاب يشوفون هاي الرسالة مايشوفون الرسالة الفوگ: '${messageData.publicMessage}')`;
            
            if (messageToShow.length > 200) {
                messageToShow = messageData.secretMessage.substring(0, 150) + '... (الرسالة أطول من اللازم للعرض الكامل هنا)';
            }
            
            await ctx.answerCbQuery(messageToShow, { show_alert: true });
            console.log(`تم عرض الرسالة السرية للرسالة ${msgId} للمستخدم ${clickerId}`);
        } else {
            await ctx.answerCbQuery(messageData.publicMessage, { show_alert: true });
            console.log(`تم عرض الرسالة العامة للرسالة ${msgId} للمستخدم ${clickerId}`);
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

