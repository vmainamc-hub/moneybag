jest.mock('@/external/bot-skeleton', () => ({
    load: jest.fn(),
    save_types: { LOCAL: 'local' },
}));

jest.mock('@/hooks/useStore', () => ({
    useStore: jest.fn(),
}));

import { getBestBotsForFolder } from '../best-bots';
import { getBestBotsFileUrl } from '@/components/shared';

describe('Best Bots domain catalogs', () => {
    it('uses Termica-branded names for the TermicaFX folder', () => {
        const bots = getBestBotsForFolder('derivhhub.com');

        expect(bots).toHaveLength(15);
        expect(bots.every(bot => bot.name.toLowerCase().includes('termica'))).toBe(true);
        expect(bots[0]).toMatchObject({
            name: 'Termica Pro Bot',
            file: 'D1-BY MR.DUKE(+254702490526).xml',
        });
    });

    it('keeps the premium Risk Managers bot first for the Risk Managers folder', () => {
        const bots = getBestBotsForFolder('riskmanagers.site');

        expect(bots).toHaveLength(5);
        expect(bots[0]).toMatchObject({
            id: 'double-under-bot',
            name: 'Double Under bot',
            file: 'Double Under bot.xml',
            guide_file: 'guides/Mighty_Double_Under_Bot_Quick_Guide.pdf',
            is_premium: true,
            priority: 1,
        });
        expect(bots[1]).toMatchObject({
            name: 'Percentage Over by Mr Duke',
            file: 'Percentage Over by Mr Duke.xml',
        });
        expect(bots[2]).toMatchObject({
            name: 'grffy v1',
            file: 'grffy v1.xml',
        });
    });

    it('resolves bot assets only from the bundled /bots path', () => {
        expect(getBestBotsFileUrl('Double Under bot.xml')).toBe('/bots/Double%20Under%20bot.xml');
        expect(getBestBotsFileUrl('guides/Mighty_Double_Under_Bot_Quick_Guide.pdf')).toBe(
            '/bots/guides/Mighty_Double_Under_Bot_Quick_Guide.pdf'
        );
    });

    it('does not leak another domain catalog for an unknown folder', () => {
        expect(getBestBotsForFolder('future-domain.site')).toEqual([]);
    });
});
