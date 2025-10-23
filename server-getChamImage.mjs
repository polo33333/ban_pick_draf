import https from "https";
import path from "path";
import fs from 'fs';

// // URL JSON gốc
// const url = 'https://api.hakush.in/ww/data/character.json';

// // Tạo thư mục nếu chưa tồn tại
// if (!fs.existsSync('icon')) fs.mkdirSync('icon');
// if (!fs.existsSync('background')) fs.mkdirSync('background');

// // Hàm tải file ảnh từ URL, skip nếu đã tồn tại
// function downloadImage(url, filepath) {
//   return new Promise((resolve, reject) => {
//     if (fs.existsSync(filepath)) {          // <-- Skip nếu file đã tồn tại
//       console.log(`File đã tồn tại, bỏ qua: ${filepath}`);
//       resolve();
//       return;
//     }

//     https.get(url, (res) => {
//       if (res.statusCode !== 200) {
//         reject(`Failed to get '${url}' (${res.statusCode})`);
//         return;
//       }
//       const file = fs.createWriteStream(filepath);
//       res.pipe(file);
//       file.on('finish', () => file.close(resolve));
//     }).on('error', (err) => {
//       reject(err);
//     });
//   });
// }

// // Hàm delay ngẫu nhiên (200-500ms)
// function randomDelay() {
//   const ms = 200 + Math.floor(Math.random() * 300);
//   return new Promise(resolve => setTimeout(resolve, ms));
// }

// // Tải JSON từ URL
// https.get(url, (res) => {
//   let data = '';

//   res.on('data', chunk => data += chunk);
//   res.on('end', async () => {
//     try {
//       const json = JSON.parse(data);

//       for (const id in json) {
//         const character = json[id];
//         const name = (character.en || id).replace(/[\/\\?%*:|"<>]/g, '_');

//         // Thay thế đường dẫn và chuyển .T... -> .webp
//         if (character.icon) {
//           character.icon = character.icon
//             .replace(/^\/?Game\/Aki\//, 'https://api.hakush.in/ww/')
//             .replace(/\.T.*$/, '.webp');
//         }

//         if (character.background) {
//           character.background = character.background
//             .replace(/^\/?Game\/Aki\//, 'https://api.hakush.in/ww/')
//             .replace(/\.T.*$/, '.webp');
//         }

//         // Tải icon
//         // if (character.icon) {
//         //   const iconPath = path.join('icon', `${name}.webp`);
//         //   try {
//         //     await downloadImage(character.icon, iconPath);
//         //     console.log(`Đã tải icon: ${iconPath}`);
//         //   } catch (err) {
//         //     console.error(`Lỗi tải icon ${name}:`, err);
//         //   }
//         //   await randomDelay();
//         // }

//         // Tải background
//         if (character.background) {
//           const bgPath = path.join('background', `${name}.webp`);
//           try {
//             await downloadImage(character.background, bgPath);
//             console.log(`Đã tải background: ${bgPath}`);
//           } catch (err) {
//             console.error(`Lỗi tải background ${name}:`, err);
//           }
//           await randomDelay();
//         }
//       }

//       // Lưu JSON đã chỉnh sửa
//       fs.writeFileSync('character_updated.json', JSON.stringify(json, null, 2), 'utf-8');
//       console.log('Đã lưu file character_updated.json thành công!');

//     } catch (err) {
//       console.error('Lỗi khi parse JSON:', err);
//     }
//   });

// }).on('error', err => console.error('Lỗi khi tải JSON:', err));


const inputFile = './character.json';       // JSON gốc
const outputFile = './character_local.json'; // JSON sau khi đổi URL

const data = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));

for (const id in data) {
  const character = data[id];
  const name = (character.en || id).replace(/[\/\\?%*:|"<>]/g, '_'); // tên file hợp lệ

  // Cập nhật URL icon và background sang local path
  if (character.icon) {
    character.icon = path.join('/icon', `${name}.webp`).replace(/\\/g, '/'); // dùng / cho URL
  }

  if (character.background) {
    character.background = path.join('/background', `${name}.webp`).replace(/\\/g, '/');
  }
}

// Lưu JSON mới
fs.writeFileSync(outputFile, JSON.stringify(data, null, 2), 'utf-8');
console.log(`Đã lưu JSON với URL icon/background local vào ${outputFile}`);