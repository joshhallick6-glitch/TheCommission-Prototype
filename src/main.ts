import Phaser from 'phaser';
import { MenuScene } from './scenes/MenuScene';
import { LobbyScene } from './scenes/LobbyScene';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { UIScene } from './scenes/UIScene';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-container',
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: '#1a1a1a',
  pixelArt: true,
  physics: {
    default: 'arcade',
    arcade: {
      debug: false,
    },
  },
  scene: [MenuScene, LobbyScene, BootScene, GameScene, UIScene],
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  input: {
    mouse: {
      target: undefined,
    },
  },
};

new Phaser.Game(config);
