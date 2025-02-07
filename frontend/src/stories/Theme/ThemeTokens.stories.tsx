import type { Meta, StoryObj } from '@storybook/react';
import { defaultTheme, Theme } from '../../config/theme';

type ThemeValue = string | number | Record<string, unknown>;

const TokenDisplay = ({ theme, tokenPath }: { theme: Theme; tokenPath: string[] }) => {
  const getValue = (obj: Record<string, ThemeValue>, path: string[]): ThemeValue => 
    path.reduce<Record<string, ThemeValue> | ThemeValue>((acc, key) => 
      (acc as Record<string, ThemeValue>)[key], obj);

  const value = getValue(theme as Record<string, ThemeValue>, tokenPath);
  
  return (
    <div style={{ 
      display: 'flex', 
      alignItems: 'center', 
      gap: '1rem',
      padding: '0.5rem',
      borderBottom: '1px solid #eee'
    }}>
      <div style={{ flex: 1 }}>
        {tokenPath.join('.')}
      </div>
      <div style={{ 
        width: '100px', 
        height: '24px',
        background: typeof value === 'string' ? value : undefined,
        border: '1px solid #ccc',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '0.875rem'
      }}>
        {typeof value === 'string' ? value : JSON.stringify(value)}
      </div>
    </div>
  );
};

const meta = {
  title: 'Theme/Tokens',
  component: TokenDisplay,
} satisfies Meta<typeof TokenDisplay>;

export default meta;
type Story = StoryObj<typeof TokenDisplay>;

export const Colors: Story = {
  render: () => (
    <div>
      <h3>Background Colors</h3>
      {Object.keys(defaultTheme.colors.background).map(key => (
        <TokenDisplay 
          key={key} 
          theme={defaultTheme} 
          tokenPath={['colors', 'background', key]} 
        />
      ))}
      
      <h3>Foreground Colors</h3>
      {Object.keys(defaultTheme.colors.foreground).map(key => (
        <TokenDisplay 
          key={key} 
          theme={defaultTheme} 
          tokenPath={['colors', 'foreground', key]} 
        />
      ))}
    </div>
  ),
}; 