# AutoScroller CifraClub 🎸

Extensão para navegadores que destaca acordes no CifraClub e faz acompanhamento inteligente da cifra conforme você toca, com reconhecimento de áudio e navegação interativa.

## 🚀 Instalação (Modo Desenvolvedor)

1. Baixe ou clone este repositório e extraia os arquivos em uma pasta.
2. No navegador (Chrome, Edge, Brave, Opera):
   - Acesse `chrome://extensions/`.
   - Ative o "Modo do desenvolvedor".
   - Clique em "Carregar sem compactação" e selecione a pasta da extensão.
3. No Firefox:
   - Acesse `about:debugging#/runtime/this-firefox`.
   - Clique em "Carregar Extensão Temporária" e selecione o arquivo `manifest.json`.


## 🔖 Como Usar via Bookmarklet (sem instalar extensão)

Você pode executar a extensão **sem instalar nada** usando um **bookmarklet**, um favorito especial que executa o código direto no navegador.

### 📱 No Celular (Android ou iOS)

> Requer navegador com suporte a favoritos personalizados (como Safari ou Firefox no iOS, ou Kiwi Browser / Firefox no Android)

1. Copie este código JavaScript:

```
javascript:(function(){
    if (window.cifraAppInstance) {
        console.log('CifraApp já está rodando.');
        return;
    }
    var script = document.createElement('script');
    script.src = 'https://raw.githack.com/lucasrealdev/AutoScrollerCifra/main/content.js';
    document.body.appendChild(script);
})()
```

2. Abra o navegador no seu celular.
3. Entre no [CifraClub](https://www.cifraclub.com.br/) e adicione qualquer página aos seus **favoritos**.
4. Vá até os favoritos e **edite o favorito criado**:

   * **Nome:** AutoScroller Inteligente
   * **URL:** cole o código acima (começando com `javascript:`).
5. Para usar:

   * Acesse uma cifra no CifraClub.
   * Abra seus favoritos e clique em **AutoScroller Inteligente** Ou pesquise pelo nome que você deu ao favorito na barra de pesquisa.
   * O script será carregado e a extensão iniciará automaticamente.

---

### 💻 No Desktop (Chrome, Edge, Firefox, Brave)

1. Copie o código abaixo:

```
javascript:(function(){
    if (window.cifraAppInstance) {
        console.log('CifraApp já está rodando.');
        return;
    }
    var script = document.createElement('script');
    script.src = 'https://raw.githack.com/lucasrealdev/AutoScrollerCifra/main/content.js';
    document.body.appendChild(script);
})()
```

2. Arraste este link para sua barra de favoritos: ➡️

3. Para usar:

   * Acesse o [CifraClub](https://www.cifraclub.com.br/).
   * Clique no favorito “**AutoScroller Inteligente**”.
   * A extensão será executada automaticamente na página.

## 🎯 Como Usar

1. **Abra uma cifra no [CifraClub](https://www.cifraclub.com.br/)**.
2. **Clique em "Começar"** no canto inferior esquerdo.
   - O acompanhamento e a detecção de acordes começam a partir da linha escolhida.
3. **Esconda tablaturas para enchergar melhor**

---

## 🖱️ Navegação por Clique

- **Você pode clicar em qualquer acorde durante o acompanhamento**
  - O sistema irá marcar todos os acordes anteriores como tocados.
  - O acompanhamento e o destaque visual continuam a partir do acorde clicado.
  - Funciona tanto para avançar quanto para voltar!

---

## 🎵 Como funciona a detecção e acompanhamento

- O sistema espera você tocar o acorde esperado da cifra (considerando o capo, se houver).
- O acompanhamento só começa a contar o tempo após você tocar o primeiro acorde válido da linha escolhida (ou pular para o 2º/3º acorde, veja abaixo).
- O acorde detectado aparece no painel inferior, e a linha atual é destacada.
- **Scroll suave:** a linha atual sempre fica centralizada na tela, com contexto acima.

---

## ⏩ Mecânica de pulo de acordes

- **Você pode pular até 2 acordes** (inclusive atravessando linhas):
  - Se tocar o 2º acorde à frente, os anteriores são marcados como tocados (tolerância: 2 segundos).
  - Se tocar o 3º acorde à frente, os dois anteriores são marcados como tocados (tolerância: 3 segundos).
  - O tempo de tolerância é proporcional ao número de acordes pulados.
- **Exemplo:**
  - Linha 1: G | D | Em
  - Linha 2: Am | C
  - Se você está em G e tocar C (3 acordes à frente), todos os anteriores serão marcados como tocados, desde que respeite o tempo de tolerância.

---

## ⚡ Dicas e Comportamento Visual

- **Linha Atual** fica azul, mas nao se preocupe se ultrapassar ela, pois ela te alcança.
- **Timer:**
  - Você tem até 7 segundos para tocar o acorde esperado antes do sistema avançar automaticamente.
  - O timer é reiniciado a cada novo acorde esperado.
- **Capotraste:**
  - Se a cifra indicar capo, a detecção já considera a transposição dos acordes.
- **Parar acompanhamento:**
  - Clique em "Parar" para resetar tudo e escolher uma nova linha de início.

---


https://github.com/user-attachments/assets/83cbf75b-5114-42b0-8741-2db47fa84d2f


## 💡 Observações

- O sistema é tolerante a ruídos e falhas breves de detecção.
- O campo "Acorde detectado" mostra o acorde real e, se houver capo, o acorde transposto.

---

## Observação importante sobre o uso do capo

Se você adicionar ou alterar o capo manualmente no Cifra Club, atualize a página para que a extensão recarregue e detecte corretamente o novo valor do capo.

---

## 👨‍💻 Contribua

Sugestões, melhorias e PRs são bem-vindos!

---

**Divirta-se tocando e estudando com mais autonomia!**
