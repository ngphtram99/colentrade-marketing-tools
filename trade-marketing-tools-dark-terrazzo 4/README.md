# Trade Marketing Tools

Một app Vercel tĩnh gom nhiều công cụ vào chung một giao diện menu.

- `index.html`: app shell và menu chính.
- `dsm/`: công cụ Định Mức Cấp Mẫu.
- `image-tools/`: dashboard cập nhật/duyệt hình ảnh.
- `api/`: Vercel API routes cho dashboard hình ảnh.

DSM hiện vẫn dùng Google Apps Script gốc để lấy dữ liệu live từ Google Sheets.

## Vercel environment variables cho công cụ hình ảnh

Cách 1, dùng Apps Script trung gian:

- `APPS_SCRIPT_API_URL`

Cách 2, đọc trực tiếp Google Sheets và Drive:

- `SPREADSHEET_ID`
- `SHEET_NAMES` ví dụ: `Miền Tây,Miền Đông,Hồ Chí Minh,Miền Trung`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
