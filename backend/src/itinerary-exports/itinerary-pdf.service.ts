import { Readable } from 'node:stream';
import { Injectable } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import PDFDocument from 'pdfkit';
import { ItineraryDto } from '../itineraries/dto/itinerary-response.dto';
const ARABIC_RUN = /([\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]+(?: +[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]+)*)/g;
const IS_ARABIC = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/;
function amount(value: number, currency: string): string { return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value) + ' ' + currency; }
function fontDirectory(): string {
  const candidates = [resolve(__dirname, '../../assets/fonts'), resolve(process.cwd(), 'assets/fonts'), resolve(process.cwd(), 'backend/assets/fonts')];
  const directory = candidates.find((candidate) => existsSync(resolve(candidate, 'NotoSans-Regular.ttf')));
  if (!directory) throw new Error('Bundled PDF fonts are missing');
  return directory;
}
/** Presentation only: authorization, dates, ordering, references and values come from the exported read DTO. */
@Injectable()
export class ItineraryPdfService {
  generate(itinerary: ItineraryDto): Promise<Buffer> {
    return new Promise((resolveBuffer, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: { Title: itinerary.title, Author: 'Travel Planning and Booking Platform', Subject: 'Printable travel itinerary' } });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk)); doc.on('end', () => resolveBuffer(Buffer.concat(chunks))); doc.on('error', reject);
      try {
        const directory = fontDirectory();
        doc.registerFont('Body', resolve(directory, 'NotoSans-Regular.ttf')).registerFont('Strong', resolve(directory, 'NotoSans-Bold.ttf')).registerFont('Arabic', resolve(directory, 'NotoSansArabic-Regular.ttf'));
        const header = () => {
          doc.font('Body').fontSize(8).fillColor('#475569').text('TRAVEL PLANNING / ITINERARY', 48, 24, { lineBreak: false });
          doc.moveTo(48, 43).lineTo(doc.page.width - 48, 43).strokeColor('#0f766e').lineWidth(1).stroke(); doc.x = 48; doc.y = 60;
        };
        doc.on('pageAdded', header); header();
        const text = (value: string, size = 10, strong = false, color = '#1e293b') => {
          const clean = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
          const runs = clean.split(ARABIC_RUN).filter(Boolean);
          for (let i = 0; i < runs.length; i++) doc.font(IS_ARABIC.test(runs[i]) ? 'Arabic' : strong ? 'Strong' : 'Body').fontSize(size).fillColor(color).text(runs[i], { continued: i < runs.length - 1, baseline: -size * 1.069, lineGap: 3, width: doc.page.width - 96 });
        };
        const section = (title: string) => { if (doc.y > doc.page.height - 120) doc.addPage(); doc.moveDown(0.6); text(title, 14, true, '#0f766e'); doc.moveDown(0.25); };
        text(itinerary.title, 23, true); doc.moveDown(0.3);
        text((itinerary.author?.name ? 'By ' + itinerary.author.name + ' | ' : '') + itinerary.visibility, 9, false, '#64748b');
        text('Dates: ' + itinerary.startDate + (itinerary.endDate ? ' to ' + itinerary.endDate : '') + ' | ' + itinerary.dayCount + ' day(s)', 10);
        text('Countries: ' + itinerary.countries.join(', ') + ' | Budget display currency: ' + itinerary.currency, 9);
        if (itinerary.description) { doc.moveDown(0.5); text(itinerary.description); }
        if (itinerary.clonedFrom) { doc.moveDown(0.4); text('Adapted from "' + itinerary.clonedFrom.title + '" by ' + itinerary.clonedFrom.authorName + '.', 9, false, '#64748b'); }
        if (!itinerary.days.length) { section('Your plan'); text('No days have been added yet.'); }
        for (const day of itinerary.days) {
          section('Day ' + day.dayNumber + ' - ' + day.date + ' - ' + day.city);
          if (day.notes) text(day.notes);
          if (!day.activities.length) text('No activities planned.', 9, false, '#64748b');
          for (const activity of day.activities) {
            const title = (activity.startTime ? activity.startTime + (activity.endTime ? '-' + activity.endTime : '') + ' | ' : '') + activity.title;
            const lines = [{ value: title, size: 11 }, ...(activity.location ? [{ value: 'Location: ' + activity.location, size: 9 }] : []), ...(activity.description ? [{ value: activity.description, size: 10 }] : []), ...(typeof activity.cost === 'number' && activity.currency ? [{ value: 'Activity estimate: ' + amount(activity.cost, activity.currency), size: 9 }] : []), ...(activity.images.length ? [{ value: 'Photos: ' + activity.images.length, size: 8 }] : [])];
            const blockHeight = lines.reduce((sum, line) => sum + doc.font(IS_ARABIC.test(line.value) ? 'Arabic' : 'Body').fontSize(line.size).heightOfString(line.value, { width: doc.page.width - 96, lineGap: 3 }), 14);
            if (blockHeight < doc.page.height - 150 && doc.y + blockHeight > doc.page.height - 48) { doc.addPage(); text('Day ' + day.dayNumber + ' - ' + day.city + ' (continued)', 12, true, '#0f766e'); doc.moveDown(0.3); }
            doc.moveDown(0.35);
            text((activity.startTime ? activity.startTime + (activity.endTime ? '-' + activity.endTime : '') + ' | ' : '') + activity.title, 11, true);
            if (activity.location) text('Location: ' + activity.location, 9);
            if (activity.description) text(activity.description, 10);
            if (typeof activity.cost === 'number' && activity.currency) text('Activity estimate: ' + amount(activity.cost, activity.currency), 9);
            if (activity.images.length) text('Photos: ' + activity.images.length + ' (view in the platform)', 8, false, '#64748b');
          }
          if (day.budgets.length) {
            doc.moveDown(0.4); text('Recorded budget entries', 10, true);
            for (const entry of day.budgets) text(entry.category.replaceAll('_', ' ') + ': ' + amount(entry.amount, entry.currency) + (entry.description ? ' - ' + entry.description : ''), 9);
          }
        }
        if (itinerary.transportCosts.length) {
          section('Intercity transport');
          for (const cost of itinerary.transportCosts) { text(cost.fromCity + ' to ' + cost.toCity + ' | ' + cost.mode + ' | ' + amount(cost.amount, cost.currency), 10, true); if (cost.date) text('Travel date: ' + cost.date, 9); if (cost.notes) text(cost.notes, 9); doc.moveDown(0.3); }
        }
        doc.moveDown(0.7); text('Amounts are shown in their recorded currencies. This export performs no new currency conversion and does not confirm bookings.', 8, false, '#64748b');
        const range = doc.bufferedPageRange();
        for (let i = range.start; i < range.start + range.count; i++) {
          doc.switchToPage(i); const bottom = doc.page.margins.bottom; doc.page.margins.bottom = 0;
          doc.font('Body').fontSize(8).fillColor('#64748b').text('Travel Planning and Booking Platform | ' + (i + 1) + ' / ' + range.count, 48, doc.page.height - 30, { width: doc.page.width - 96, align: 'right', lineBreak: false }); doc.page.margins.bottom = bottom;
        }
        doc.end();
      } catch (error) { (doc as unknown as Readable).destroy(); reject(error); }
    });
  }
}
