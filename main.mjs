import {
    Client,
    GatewayIntentBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    Events,
    StringSelectMenuBuilder
} from "discord.js";

import dotenv from "dotenv";
import express from "express";

dotenv.config();

const TOKEN = process.env.TOKEN;

// 🔗 大学予約サイト
const RESERVATION_URL = "https://yoyaku.eng.kagoshima-u.ac.jp/cms/";

// ==============================
// Discord Client
// ==============================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages
    ]
});

client.tempData = {};

// ==============================
// Web Server
// ==============================
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
    res.send("Bot is running!");
});

app.listen(PORT, () => {
    console.log(`Web server running on port ${PORT}`);
});

// ==============================
// 起動時（ボタンID判定・最強重複防止版）
// ==============================
client.once(Events.ClientReady, async () => {
    try {
        console.log(`ログインしました: ${client.user.tag}`);

        const guilds = client.guilds.cache;
        let channel = null;

        for (const guild of guilds.values()) {
            const channels = await guild.channels.fetch();

            channel = channels.find(
                ch => ch?.name === "🖥️｜レーザー加工利用"
            );

            if (channel) break;
        }

        if (!channel) {
            console.log("🖥️｜レーザー加工利用 が見つかりません");
            return;
        }

        // テキスト送信可能か安全確認
        if (!channel.isTextBased()) return;

        const button = new ButtonBuilder()
            .setCustomId("open_form")
            .setLabel("申請する")
            .setStyle(ButtonStyle.Success)
            //.setEmoji("🔧");

        const row = new ActionRowBuilder().addComponents(button);

        // 🔍 過去のメッセージ取得数を100件に拡張
        const messages = await channel.messages.fetch({ limit: 100 });

        // 🛠️【変更箇所】メッセージの文章ではなく、「open_form」ボタンが含まれるかを判定
        const oldMsg = messages.find(msg =>
            msg.author.id === client.user.id &&
            msg.components.some(actionRow => 
                actionRow.components.some(comp => comp.customId === "open_form")
            )
        );

        if (oldMsg) {
            // すでに存在する場合はボタン（components）の状態を最新に更新
            await oldMsg.edit({ components: [row] });
            console.log("🖥️ レーザー加工利用申請ボタンは既に存在するため、既存メッセージを更新しました。");
        } else {
            // 1件もない場合のみ新しく送信
            await channel.send({
                content: "🔧 レーザー加工（GCC LaserPro C180Ⅱ）申請\nボタンから申請してください。",
                components: [row]
            });
            console.log("🖥️ レーザー加工利用申請パネルを新しく設置しました。");
        }

    } catch (err) {
        console.error(err);
    }
});

// ==============================
// Interaction
// ==============================
client.on(Events.InteractionCreate, async interaction => {
    try {
        // --------------------------
        // ボタン
        // --------------------------
        if (interaction.isButton() && interaction.customId === "open_form") {
            const modal = new ModalBuilder()
                .setCustomId("laser_modal")
                .setTitle("🔧 レーザー加工利用申請");

            const dateInput = new TextInputBuilder()
                .setCustomId("date")
                .setLabel("利用日")
                .setPlaceholder("例: 2026/05/10")
                .setStyle(TextInputStyle.Short);

            const purposeInput = new TextInputBuilder()
                .setCustomId("purpose")
                .setLabel("使用目的")
                .setPlaceholder("例: NHK学生ロボコンに向けた部品の加工")
                .setStyle(TextInputStyle.Paragraph);

            modal.addComponents(
                new ActionRowBuilder().addComponents(dateInput),
                new ActionRowBuilder().addComponents(purposeInput)
            );

            await interaction.showModal(modal);
        }

        // --------------------------
        // モーダル
        // --------------------------
        if (interaction.isModalSubmit() && interaction.customId === "laser_modal") {
            const dateStr = interaction.fields.getTextInputValue("date");
            const purpose = interaction.fields.getTextInputValue("purpose");

            const date = new Date(dateStr);

            // ❌ 日付チェック
            if (isNaN(date.getTime())) {
                await interaction.reply({
                    content: "日付形式が正しくありません。",
                    ephemeral: true
                });
                return;
            }

            // ❌ 土日チェック
            const day = date.getDay(); // 0:日 6:土
            if (day === 0 || day === 6) {
                await interaction.reply({
                    content: "土日・祝日は予約できません。",
                    ephemeral: true
                });
                return;
            }

            client.tempData[interaction.user.id] = {
                date: dateStr,
                purpose
            };

            // 時間選択（8:00〜17:00）

                const startSelect = new StringSelectMenuBuilder()
                    .setCustomId("start_time")
                    .setPlaceholder("開始時間")
                    .addOptions(
                        Array.from({ length: 10 }, (_, i) => {
                            const hour = i + 8;
                            // 💡 1桁の時は頭に 0 をつける (例: "09:00")
                            const timeStr = `${String(hour).padStart(2, '0')}:00`; 
                            return {
                                label: timeStr,
                                value: timeStr
                            };
                        })
                    );

            await interaction.reply({
                content: "開始時間を選択してください",
                components: [new ActionRowBuilder().addComponents(startSelect)],
                ephemeral: true
            });
        }

        // --------------------------
        // 開始時間
        // --------------------------
        if (interaction.isStringSelectMenu() && interaction.customId === "start_time") {
            if (!client.tempData[interaction.user.id]) {
                await interaction.reply({ content: "セッションがタイムアウトしました。最初からやり直してください。", ephemeral: true });
                return;
            }

            client.tempData[interaction.user.id].start = interaction.values[0];

            const endSelect = new StringSelectMenuBuilder()
                .setCustomId("end_time")
                .setPlaceholder("終了時間")
                .addOptions(
                    Array.from({ length: 10 }, (_, i) => {
                        const hour = i + 9;
                        return {
                            label: `${hour}:00`,
                            value: `${hour}:00`
                        };
                    })
                );

            await interaction.update({
                content: "終了時間を選択してください",
                components: [new ActionRowBuilder().addComponents(endSelect)]
            });
        }

        // --------------------------
        // 終了時間
        // --------------------------
        if (interaction.isStringSelectMenu() && interaction.customId === "end_time") {
            const data = client.tempData[interaction.user.id];
            if (!data) return;

            const end = interaction.values[0];

            if (end <= data.start) {
                await interaction.update({
                    content: "❌ エラー: 終了時間は開始時間より後にしてください。ボタンから申請をやり直してください。",
                    components: []
                });
                delete client.tempData[interaction.user.id];
                return;
            }

            const channels = await interaction.guild.channels.fetch();
            const channel = channels.find(ch => ch?.name === "🗓️｜利用予定");

            if (!channel || !channel.isTextBased()) {
                await interaction.update({
                    content: "送信先チャンネル（🗓️｜利用予定）が見つかりません。",
                    components: []
                });
                return;
            }

            const message =
`🔧 レーザー加工利用申請（GCC LaserPro C180Ⅱ）

使用日：${data.date}
時間：${data.start}〜${end}
目的：${data.purpose}

申請者：<@${interaction.user.id}>

🔗 予約サイトはこちら
${RESERVATION_URL}`;

            await channel.send({ content: message });

            delete client.tempData[interaction.user.id];

            await interaction.update({
                content: "✅ 申請完了しました！「🗓️｜利用予定」チャンネルをご確認ください。",
                components: []
            });
        }

    } catch (err) {
        console.error(err);
    }
});

client.login(TOKEN);